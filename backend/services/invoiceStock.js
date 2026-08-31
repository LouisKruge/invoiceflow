// services/invoiceStock.js
//
// What an invoice is allowed to do to stock.
//
// An invoice records what was bought. That is not the same as what is held:
// a great deal of what a company buys is bought for a job and never stocked —
// services, one-off materials, custom fabrication, direct-to-site deliveries.
// So the rule this file exists to enforce is that an invoice never invents
// inventory. It may add to a product that is already on the Product Master and
// already marked as tracked stock, and nothing else.
//
// The work happens in two stages, deliberately separated:
//
//   evaluate  — after extraction. Matches every line, records what it found,
//               changes no stock. Safe to re-run; never overrides a person.
//   post      — on approval. Reads the decisions already recorded and posts
//               the eligible ones through the ledger, atomically and once.
//
// Nothing between those two stages touches stock: not extraction, not
// matching, not viewing, not saving a draft.

const { v4: uuid } = require('uuid');

const db = require('../db');

const ledger = require('./stockLedger');
const matching = require('./productMatching');

const DOCUMENT_TYPE = 'INVOICE';

// What was decided about a line.
const DECISIONS = {
  // Matched a product that is tracked stock. Will receipt on approval.
  STOCK_MATCHED: 'STOCK_MATCHED',

  // Matched a product that exists but is deliberately not inventory.
  NON_STOCK: 'NON_STOCK',

  // No confident match. A person has to say what this is.
  UNMATCHED: 'UNMATCHED',

  // A person said explicitly: capture it, leave stock alone.
  DO_NOT_STOCK: 'DO_NOT_STOCK',

  // No quantity or no description — a subtotal, a note, a bad read.
  NOT_STOCKABLE: 'NOT_STOCKABLE',

  // Already receipted into the ledger.
  POSTED: 'POSTED',
};

// The reasons a person can give for keeping something off the books. Free text
// is allowed alongside, but these are the ones worth counting later.
const DO_NOT_STOCK_REASONS = [
  'JOB_SPECIFIC',
  'ONE_OFF_PURCHASE',
  'DIRECT_TO_JOB',
  'NON_INVENTORY',
  'OTHER',
];

/**
 * Whether a product may take stock at all.
 *
 * Both flags have to agree. A product marked NON_STOCK is not inventory
 * whatever else is set, and one with tracking switched off is not being
 * counted, so adding to it would be recording a number nobody maintains.
 */
function isStockable(product) {
  if (!product) return false;

  return (
    product.inventory_type !== 'NON_STOCK' &&
    product.track_inventory !== false
  );
}

function candidatesFor(result) {
  return (result.candidates || []).map((candidate) => ({
    product_id: candidate.product.id,
    sku: candidate.product.sku,
    description: candidate.product.description,
    confidence: Math.round(candidate.confidence * 1000) / 1000,
    method: candidate.method,
    inventory_type: candidate.product.inventory_type || 'STOCK',
    track_inventory: candidate.product.track_inventory !== false,
  }));
}

// ---------------------------------------------------------------------------
// EVALUATE
// ---------------------------------------------------------------------------

/**
 * Matches an invoice's lines and records what was found.
 *
 * Changes no stock and creates no product. A decision a person has already
 * made is left exactly as it is — re-reading a document must never quietly
 * undo somebody's answer.
 *
 * @param {string} invoiceId
 * @returns {Promise<object>} a count per decision
 */
async function evaluateInvoiceLines(invoiceId) {
  const invoice =
    await db.get('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  if (!invoice) {
    return { evaluated: false, reason: 'invoice_not_found' };
  }

  const lines =
    await db.all(
      'SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY id',
      [invoiceId]
    );

  const counts = {};

  for (const line of lines) {

    // A person's decision, or a line already in the ledger, is final.
    if (line.stock_decision_by || line.stock_decision === DECISIONS.POSTED) {
      counts[line.stock_decision] = (counts[line.stock_decision] || 0) + 1;

      continue;
    }

    const quantity = Number(line.quantity || 0);

    const usable =
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Boolean(line.description && String(line.description).trim());

    if (!usable) {
      await db.run(
        `
          UPDATE invoice_line_items
          SET stock_decision = $1,
              stock_decision_reason = $2,
              product_id = NULL,
              match_confidence = NULL,
              match_method = NULL,
              match_candidates = NULL
          WHERE id = $3
        `,
        [
          DECISIONS.NOT_STOCKABLE,
          quantity > 0 ? 'No description on this line' : 'No quantity on this line',
          line.id,
        ]
      );

      counts[DECISIONS.NOT_STOCKABLE] = (counts[DECISIONS.NOT_STOCKABLE] || 0) + 1;

      continue;
    }

    const result =
      await matching.matchProduct({
        description: line.description,
        code: line.supplier_product_code || '',
        supplier_id: invoice.supplier_id,
        limit: 5,
      });

    const confident = Boolean(result.auto && result.match);

    let decision = DECISIONS.UNMATCHED;
    let productId = null;

    if (confident) {
      productId = result.match.id;

      decision =
        isStockable(result.match)
          ? DECISIONS.STOCK_MATCHED
          : DECISIONS.NON_STOCK;
    }

    await db.run(
      `
        UPDATE invoice_line_items
        SET product_id = $1,
            match_confidence = $2,
            match_method = $3,
            match_candidates = $4,
            stock_decision = $5,
            stock_decision_reason = $6
        WHERE id = $7
      `,
      [
        productId,
        confident ? result.confidence : null,
        confident ? result.method : null,
        JSON.stringify(candidatesFor(result)),
        decision,
        decision === DECISIONS.NON_STOCK
          ? 'This product is not tracked as inventory'
          : null,
        line.id,
      ]
    );

    counts[decision] = (counts[decision] || 0) + 1;
  }

  return { evaluated: true, line_count: lines.length, counts };
}

// ---------------------------------------------------------------------------
// PLAN
// ---------------------------------------------------------------------------

/**
 * What posting this invoice would do to stock, line by line.
 *
 * Projections only — the figures are what stock *would* become, so a person
 * can see the consequence before approving rather than after.
 */
async function invoiceStockPlan(invoiceId) {
  const invoice =
    await db.get('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  if (!invoice) return null;

  const lines =
    await db.all(
      `
        SELECT
          li.*,
          p.sku,
          p.product_code,
          p.description AS product_description,
          p.inventory_type,
          p.track_inventory,
          p.bin_location,
          p.stock_group
        FROM invoice_line_items li
        LEFT JOIN products p ON p.id = li.product_id
        WHERE li.invoice_id = $1
        ORDER BY li.id
      `,
      [invoiceId]
    );

  const posted = await ledger.documentPosted(DOCUMENT_TYPE, invoiceId);

  const locationId = await ledger.defaultLocationId(null);

  const detailed = [];

  let stockLines = 0;
  let nonStockLines = 0;
  let unmatchedLines = 0;
  let excludedLines = 0;
  let expectedIncrease = 0;

  for (const line of lines) {
    const quantity = Number(line.quantity || 0);

    const decision = line.stock_decision || DECISIONS.UNMATCHED;

    let currentQuantity = null;
    let projected = null;
    let impact = 0;

    if (line.product_id) {
      currentQuantity =
        await ledger.currentQuantity(null, line.product_id, locationId);
    }

    if (decision === DECISIONS.STOCK_MATCHED && quantity > 0) {
      impact = quantity;
      projected = (currentQuantity || 0) + quantity;
    } else if (decision === DECISIONS.POSTED) {
      // Already in the ledger: the current figure includes it.
      projected = currentQuantity;
    }

    if (decision === DECISIONS.STOCK_MATCHED) {
      stockLines += 1;
      expectedIncrease += quantity;
    } else if (decision === DECISIONS.NON_STOCK) {
      nonStockLines += 1;
    } else if (decision === DECISIONS.UNMATCHED) {
      unmatchedLines += 1;
    } else if (decision === DECISIONS.DO_NOT_STOCK) {
      excludedLines += 1;
    }

    let candidates = [];

    try {
      candidates = JSON.parse(line.match_candidates || '[]');
    } catch (error) {
      candidates = [];
    }

    detailed.push({
      ...line,
      quantity,
      stock_decision: decision,
      current_quantity: currentQuantity,
      projected_quantity: projected,
      stock_impact: impact,
      candidates,
    });
  }

  return {
    invoice_id: invoiceId,
    invoice_number: invoice.invoice_number,
    invoice_status: invoice.status,
    posted: Boolean(posted),
    posted_at: posted ? posted.posted_at : null,
    lines: detailed,
    totals: {
      lines: lines.length,
      stock: stockLines,
      non_stock: nonStockLines,
      unmatched: unmatchedLines,
      excluded: excludedLines,
      expected_increase: expectedIncrease,
    },
    decisions: DECISIONS,
    reasons: DO_NOT_STOCK_REASONS,
  };
}

// ---------------------------------------------------------------------------
// DECISIONS
// ---------------------------------------------------------------------------

/**
 * Records what a person decided about one line.
 *
 * The three answers a person can give to an unmatched line — match an
 * existing product, keep it off the books, or (through createProductForLine)
 * add it as a new one — all land here, and all of them are reversible right
 * up until the invoice is posted.
 */
async function setLineDecision(invoiceId, lineId, choice, userId) {
  const line =
    await db.get(
      'SELECT * FROM invoice_line_items WHERE id = $1 AND invoice_id = $2',
      [lineId, invoiceId]
    );

  if (!line) return { updated: false, reason: 'line_not_found' };

  if (line.stock_decision === DECISIONS.POSTED) {
    return { updated: false, reason: 'already_posted' };
  }

  const decision = choice.decision;

  if (decision === DECISIONS.DO_NOT_STOCK) {
    await db.run(
      `
        UPDATE invoice_line_items
        SET stock_decision = $1,
            stock_decision_reason = $2,
            stock_decision_by = $3,
            stock_decision_at = NOW()
        WHERE id = $4
      `,
      [
        DECISIONS.DO_NOT_STOCK,
        choice.reason || 'NON_INVENTORY',
        userId || null,
        lineId,
      ]
    );

    return { updated: true, decision: DECISIONS.DO_NOT_STOCK };
  }

  if (decision === DECISIONS.STOCK_MATCHED || decision === DECISIONS.NON_STOCK) {
    if (!choice.product_id) {
      return { updated: false, reason: 'product_required' };
    }

    const product =
      await db.get('SELECT * FROM products WHERE id = $1', [choice.product_id]);

    if (!product) return { updated: false, reason: 'product_not_found' };

    // What the product is decides what the line becomes. Choosing a product
    // that is not inventory cannot make it inventory.
    const resolved =
      isStockable(product) ? DECISIONS.STOCK_MATCHED : DECISIONS.NON_STOCK;

    await db.run(
      `
        UPDATE invoice_line_items
        SET product_id = $1,
            match_confidence = 1,
            match_method = 'manual_review',
            stock_decision = $2,
            stock_decision_reason = $3,
            stock_decision_by = $4,
            stock_decision_at = NOW()
        WHERE id = $5
      `,
      [
        product.id,
        resolved,
        resolved === DECISIONS.NON_STOCK
          ? 'This product is not tracked as inventory'
          : null,
        userId || null,
        lineId,
      ]
    );

    const invoice =
      await db.get('SELECT supplier_id FROM invoices WHERE id = $1', [invoiceId]);

    // A person confirming a product is the only thing worth learning from.
    await matching.rememberMatch({
      supplierId: invoice ? invoice.supplier_id : null,
      sourceText: line.description,
      sourceCode: line.supplier_product_code,
      productId: product.id,
      method: 'manual_review',
      confidence: 1,
      userId,
    });

    return { updated: true, decision: resolved, product };
  }

  if (decision === DECISIONS.UNMATCHED) {
    // Undoing a decision: back to needing one, and the matcher's own reading
    // is restored by re-evaluating.
    await db.run(
      `
        UPDATE invoice_line_items
        SET stock_decision = $1,
            stock_decision_reason = NULL,
            stock_decision_by = NULL,
            stock_decision_at = NULL,
            product_id = NULL,
            match_confidence = NULL,
            match_method = NULL
        WHERE id = $2
      `,
      [DECISIONS.UNMATCHED, lineId]
    );

    return { updated: true, decision: DECISIONS.UNMATCHED };
  }

  return { updated: false, reason: 'unknown_decision' };
}

/**
 * Adds a line to the Product Master as a new stock product.
 *
 * Only ever called from an explicit confirmation. Nothing in extraction,
 * matching or posting reaches this.
 */
async function createProductForLine(invoiceId, lineId, fields, userId) {
  const line =
    await db.get(
      'SELECT * FROM invoice_line_items WHERE id = $1 AND invoice_id = $2',
      [lineId, invoiceId]
    );

  if (!line) return { created: false, reason: 'line_not_found' };

  if (line.stock_decision === DECISIONS.POSTED) {
    return { created: false, reason: 'already_posted' };
  }

  const invoice =
    await db.get('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  const description =
    (fields.description || line.description || '').trim();

  if (!description) return { created: false, reason: 'description_required' };

  const inventoryType =
    fields.inventory_type === 'NON_STOCK' ? 'NON_STOCK' : 'STOCK';

  const trackInventory =
    inventoryType === 'NON_STOCK' ? false : fields.track_inventory !== false;

  const product =
    await db.transaction(async (client) => {
      const productId = uuid();

      const inserted =
        await client.query(
          `
            INSERT INTO products (
              id, sku, product_code, description, normalized_description,
              category, unit_of_measure, unit_cost, supplier_id,
              supplier_product_code, bin_location, stock_group,
              inventory_type, track_inventory, created_by
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING *
          `,
          [
            productId,
            fields.sku || null,
            fields.product_code || null,
            description,
            matching.normalizeDescription(description),
            fields.category || null,
            fields.unit_of_measure || line.unit_of_measure || 'ea',
            line.unit_price ?? 0,
            invoice ? invoice.supplier_id : null,
            line.supplier_product_code || null,
            fields.bin_location || null,
            fields.stock_group || null,
            inventoryType,
            trackInventory,
            userId || null,
          ]
        );

      const created = inserted.rows[0];

      if (created.bin_location) {
        await matching.rememberBin(
          {
            productId: created.id,
            bin: created.bin_location,
            source: 'invoice',
            userId,
          },
          client
        );
      }

      // The line points at the new product, and takes its quantity on
      // approval like any other matched line. Creating the product does not
      // move stock — posting does.
      await client.query(
        `
          UPDATE invoice_line_items
          SET product_id = $1,
              match_confidence = 1,
              match_method = 'created_from_invoice',
              stock_decision = $2,
              stock_decision_reason = NULL,
              stock_decision_by = $3,
              stock_decision_at = NOW()
          WHERE id = $4
        `,
        [
          created.id,
          isStockable(created) ? DECISIONS.STOCK_MATCHED : DECISIONS.NON_STOCK,
          userId || null,
          lineId,
        ]
      );

      return created;
    });

  return { created: true, product };
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

/**
 * Receipts an approved invoice's stock-eligible lines.
 *
 * Reads decisions; makes none. A line posts only because it is marked
 * STOCK_MATCHED and its product is still tracked stock — so what a person
 * confirmed on the review screen is exactly what reaches the ledger.
 *
 * Safe to call more than once: the ledger's document gate means a second call
 * for the same invoice adds nothing.
 */
/**
 * Parks undecided lines in the stock review queue.
 *
 * The queue is the long-standing place a person picks the *existing* product a
 * line refers to; it never creates one. Lines land here only when approval
 * happened before anybody answered them, so nothing is silently lost.
 */
async function queueForReview(lines, invoice, locationId) {
  for (const line of lines) {

    let candidates = [];

    try {
      candidates = JSON.parse(line.match_candidates || '[]');
    } catch (error) {
      candidates = [];
    }

    const best =
      candidates.length
        ? Math.max(...candidates.map((c) => Number(c.confidence) || 0))
        : null;

    await db.run(
      `
        INSERT INTO stock_review_queue (
          id, source_document_type, source_document_id, source_line_id,
          raw_description, raw_code, quantity, unit_cost, supplier_id,
          location_id, candidates, best_confidence
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT DO NOTHING
      `,
      [
        uuid(),
        DOCUMENT_TYPE,
        invoice.id,
        line.id,
        line.description,
        line.supplier_product_code || null,
        Number(line.quantity || 0),
        line.unit_price ?? null,
        invoice.supplier_id || null,
        locationId,
        JSON.stringify(candidates),
        best,
      ]
    );
  }
}

async function postInvoiceToStock(invoiceId, userId) {
  const invoice =
    await db.get('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  if (!invoice) {
    return { posted: false, reason: 'invoice_not_found' };
  }

  // Stock moves on approval, never on upload, extraction, matching or a draft.
  if (invoice.status !== 'approved') {
    return { posted: false, reason: 'not_approved', status: invoice.status };
  }

  const already = await ledger.documentPosted(DOCUMENT_TYPE, invoiceId);

  if (already) {
    return {
      posted: false,
      reason: 'already_posted',
      posted_at: already.posted_at,
      transaction_count: already.transaction_count,
    };
  }

  // Anything never evaluated — an invoice captured before this existed — gets
  // its reading now. Decisions already made are untouched by this.
  await evaluateInvoiceLines(invoiceId);

  const lines =
    await db.all(
      `
        SELECT li.*, p.inventory_type, p.track_inventory, p.is_active
        FROM invoice_line_items li
        LEFT JOIN products p ON p.id = li.product_id
        WHERE li.invoice_id = $1
        ORDER BY li.id
      `,
      [invoiceId]
    );

  const locationId = await ledger.defaultLocationId(null);

  const movements = [];
  const held = [];
  const queued = [];
  const skipped = [];

  for (const line of lines) {
    if (line.stock_decision !== DECISIONS.STOCK_MATCHED) {

      // Nobody said what this line is. It is not guessed into stock and it is
      // not dropped either — it goes to the review queue with the candidates
      // already found, for a person to point at an existing product.
      if (line.stock_decision === DECISIONS.UNMATCHED) {
        held.push({
          line_id: line.id,
          description: line.description,
          reason: 'awaiting_decision',
        });

        queued.push(line);
      }

      // A subtotal, a note or a bad read. Recorded on the invoice, ignored
      // by stock.
      if (line.stock_decision === DECISIONS.NOT_STOCKABLE) {
        skipped.push({
          line_id: line.id,
          description: line.description,
          reason:
            Number(line.quantity || 0) > 0 ? 'no_description' : 'no_quantity',
        });
      }

      continue;
    }

    // The decision named a product; the product still has to allow it. A
    // product switched to NON_STOCK after the decision was made does not
    // receipt.
    if (!line.product_id || !isStockable(line)) {
      held.push({
        line_id: line.id,
        description: line.description,
        reason: 'product_not_stockable',
      });

      continue;
    }

    movements.push({
      product_id: line.product_id,
      location_id: locationId,
      transaction_type: 'PURCHASE_RECEIPT',
      quantity: Number(line.quantity),
      unit_cost: line.unit_price ?? null,
      supplier_id: invoice.supplier_id || null,
      source_line_id: line.id,
      reason: `Received on invoice ${invoice.invoice_number || invoiceId}`,
      match_confidence: line.match_confidence,
      created_by: userId || null,
    });
  }

  await queueForReview(queued, invoice, locationId);

  if (!movements.length) {
    return {
      posted: false,
      reason: 'no_stock_lines',
      held_count: held.length,
      held,
      queued_count: queued.length,
      skipped_count: skipped.length,
      skipped,
      transactions: [],
    };
  }

  const posting =
    await ledger.postDocument({
      documentType: DOCUMENT_TYPE,
      documentId: invoiceId,
      movements,
      postedBy: userId,
    });

  if (posting.posted) {
    for (const transaction of posting.transactions) {
      await db.run(
        `
          UPDATE invoice_line_items
          SET stock_decision = $1
          WHERE id = $2
        `,
        [DECISIONS.POSTED, transaction.source_line_id]
      );
    }
  }

  return {
    posted: posting.posted,
    reason: posting.reason || null,
    transactions: posting.transactions || [],
    posted_count: (posting.transactions || []).length,
    held_count: held.length,
    held,
    queued_count: queued.length,
    skipped_count: skipped.length,
    skipped,
  };
}

module.exports = {
  DOCUMENT_TYPE,
  DECISIONS,
  DO_NOT_STOCK_REASONS,
  isStockable,
  evaluateInvoiceLines,
  invoiceStockPlan,
  setLineDecision,
  createProductForLine,
  postInvoiceToStock,
};
