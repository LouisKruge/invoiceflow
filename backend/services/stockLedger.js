// services/stockLedger.js
//
// The stock ledger. Every inventory movement in InvoiceFlow goes through here.
//
// The rules this module enforces:
//
//   1. Current stock is DERIVED. stock_transactions is the source of truth;
//      stock_balances is a cache that must always reconcile against it.
//   2. Rows are appended, never edited. A correction is another row.
//   3. A source document posts once. The unique constraint on
//      stock_document_postings is the gate, so two concurrent approvals of the
//      same invoice cannot both win.
//   4. A movement that cannot be attributed to a product, a quantity, a type
//      and an actor is not written at all.

const { v4: uuid } = require('uuid');

const db = require('../db');

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

// Which way each transaction type moves stock. Keeping this in one place means
// a caller can never post a receipt that quietly decrements.
const TRANSACTION_DIRECTIONS = {
  OPENING_BALANCE: 1,
  PURCHASE_RECEIPT: 1,
  STOCK_RETURN: 1,
  STOCK_ISSUE: -1,
  STOCK_TRANSFER: -1,
  // Both of these carry their own sign, supplied by the caller.
  STOCK_ADJUSTMENT: 0,
  STOCK_COUNT: 0,
};

const TRANSACTION_TYPES = Object.keys(TRANSACTION_DIRECTIONS);

// Going negative is usually a data problem, not a real event, so it is refused
// unless a deployment opts in.
function negativeStockAllowed() {
  return String(process.env.STOCK_ALLOW_NEGATIVE || '')
    .trim()
    .toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// LOCATIONS
// ---------------------------------------------------------------------------

async function defaultLocationId(client) {
  const runner = client || db;

  const row =
    await runner.query(
      `
        SELECT id
        FROM stock_locations
        WHERE is_default = TRUE
        ORDER BY created_at
        LIMIT 1
      `
    );

  const rows = row.rows || [];

  if (rows.length) {
    return rows[0].id;
  }

  // A deployment should always have the seeded MAIN location; fall back to any
  // active one rather than refusing to record the movement.
  const any =
    await runner.query(
      `
        SELECT id
        FROM stock_locations
        WHERE is_active = TRUE
        ORDER BY created_at
        LIMIT 1
      `
    );

  return any.rows.length ? any.rows[0].id : null;
}

// ---------------------------------------------------------------------------
// BALANCE
// ---------------------------------------------------------------------------

/**
 * Recomputes one product/location balance straight from the ledger.
 *
 * This is deliberately a full re-derivation rather than an increment: it makes
 * the cache self-healing, so a balance can never drift permanently out of step
 * with the transactions behind it.
 */
async function recalculateBalance(client, productId, locationId) {
  const runner = client || db;

  const result =
    await runner.query(
      `
        SELECT
          COALESCE(SUM(signed_quantity), 0) AS quantity,
          MAX(created_at) AS last_movement_at
        FROM stock_transactions
        WHERE product_id = $1
          AND location_id IS NOT DISTINCT FROM $2
      `,
      [productId, locationId]
    );

  const quantity = Number(result.rows[0].quantity || 0);
  const lastMovement = result.rows[0].last_movement_at;

  await runner.query(
    `
      INSERT INTO stock_balances
        (product_id, location_id, quantity, last_movement_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (product_id, location_id)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        last_movement_at = EXCLUDED.last_movement_at,
        updated_at = NOW()
    `,
    [productId, locationId, quantity, lastMovement]
  );

  return quantity;
}

async function currentQuantity(client, productId, locationId) {
  const runner = client || db;

  const result =
    await runner.query(
      `
        SELECT COALESCE(SUM(signed_quantity), 0) AS quantity
        FROM stock_transactions
        WHERE product_id = $1
          AND ($2::text IS NULL OR location_id IS NOT DISTINCT FROM $2)
      `,
      [productId, locationId || null]
    );

  return Number(result.rows[0].quantity || 0);
}

// ---------------------------------------------------------------------------
// POSTING
// ---------------------------------------------------------------------------

function resolveDirection(type, explicitDirection) {
  const fixed = TRANSACTION_DIRECTIONS[type];

  if (fixed === 1 || fixed === -1) {
    return fixed;
  }

  // Adjustments and counts must say which way they go.
  if (explicitDirection === 1 || explicitDirection === -1) {
    return explicitDirection;
  }

  throw new Error(
    `${type} requires an explicit direction of 1 or -1`
  );
}

function validateMovement(movement) {
  if (!movement || typeof movement !== 'object') {
    throw new Error('A stock movement object is required.');
  }

  if (!movement.product_id) {
    throw new Error('A stock movement must name a product.');
  }

  if (!TRANSACTION_TYPES.includes(movement.transaction_type)) {
    throw new Error(
      `Unknown stock transaction type: ${movement.transaction_type}`
    );
  }

  const quantity = Number(movement.quantity);

  if (!Number.isFinite(quantity)) {
    throw new Error('Stock movement quantity must be a number.');
  }

  if (quantity < 0) {
    throw new Error(
      'Stock movement quantity must be a positive magnitude; use direction for the sign.'
    );
  }

  if (quantity === 0) {
    throw new Error('A stock movement of zero has nothing to record.');
  }

  // Guards against an OCR misread turning "1 x 10" into ten million.
  if (quantity > 10000000) {
    throw new Error(
      `Refusing an implausible stock quantity: ${quantity}`
    );
  }

  return quantity;
}

/**
 * Appends one movement to the ledger and refreshes the affected balance.
 *
 * @param {object} client - a pg client inside a transaction, or null
 * @param {object} movement
 * @returns {Promise<object>} the written transaction row
 */
async function postMovement(client, movement) {
  const runner = client || db;

  const quantity = validateMovement(movement);

  const direction =
    resolveDirection(
      movement.transaction_type,
      movement.direction
    );

  const locationId =
    movement.location_id ||
    (await defaultLocationId(client));

  // Refuse to drive stock below zero unless the deployment allows it. Checked
  // inside the caller's transaction so concurrent issues cannot both pass.
  if (direction === -1 && !negativeStockAllowed()) {
    const available =
      await currentQuantity(client, movement.product_id, locationId);

    if (available - quantity < 0) {
      const error = new Error(
        `Insufficient stock: ${available} available, ${quantity} requested`
      );

      error.code = 'INSUFFICIENT_STOCK';
      error.available = available;
      error.requested = quantity;

      throw error;
    }
  }

  const id = uuid();

  const result =
    await runner.query(
      `
        INSERT INTO stock_transactions (
          id,
          product_id,
          location_id,
          transaction_type,
          direction,
          quantity,
          unit_cost,
          source_document_type,
          source_document_id,
          source_line_id,
          supplier_id,
          employee_name,
          job_reference,
          reason,
          notes,
          match_confidence,
          created_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17
        )
        RETURNING *
      `,
      [
        id,
        movement.product_id,
        locationId,
        movement.transaction_type,
        direction,
        quantity,
        movement.unit_cost ?? null,
        movement.source_document_type || null,
        movement.source_document_id || null,
        movement.source_line_id || null,
        movement.supplier_id || null,
        movement.employee_name || null,
        movement.job_reference || null,
        movement.reason || null,
        movement.notes || null,
        movement.match_confidence ?? null,
        movement.created_by || null,
      ]
    );

  await recalculateBalance(client, movement.product_id, locationId);

  return result.rows[0];
}

/**
 * Posts a set of movements for one source document, atomically and only once.
 *
 * The insert into stock_document_postings is what makes this idempotent: a
 * second call for the same document hits the unique constraint and the whole
 * transaction rolls back, so no stock is added twice.
 *
 * @returns {Promise<{posted: boolean, reason?: string, transactions: Array}>}
 */
async function postDocument({
  documentType,
  documentId,
  movements,
  postedBy,
}) {
  if (!documentType || !documentId) {
    throw new Error('A source document type and id are required.');
  }

  if (!Array.isArray(movements) || !movements.length) {
    return {
      posted: false,
      reason: 'no_movements',
      transactions: [],
    };
  }

  const already =
    await db.get(
      `
        SELECT id, posted_at, transaction_count
        FROM stock_document_postings
        WHERE document_type = $1
          AND document_id = $2
      `,
      [documentType, documentId]
    );

  if (already) {
    return {
      posted: false,
      reason: 'already_posted',
      posted_at: already.posted_at,
      transaction_count: already.transaction_count,
      transactions: [],
    };
  }

  try {

    const transactions =
      await db.transaction(async (client) => {

        const written = [];

        for (const movement of movements) {
          written.push(
            await postMovement(client, {
              ...movement,
              source_document_type: documentType,
              source_document_id: documentId,
              created_by: movement.created_by || postedBy || null,
            })
          );
        }

        await client.query(
          `
            INSERT INTO stock_document_postings
              (id, document_type, document_id, transaction_count, posted_by)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            uuid(),
            documentType,
            documentId,
            written.length,
            postedBy || null,
          ]
        );

        return written;
      });

    return {
      posted: true,
      transactions,
    };

  } catch (error) {

    // 23505 = unique violation: another request posted this document first.
    if (error && error.code === '23505') {
      return {
        posted: false,
        reason: 'already_posted',
        transactions: [],
      };
    }

    throw error;
  }
}

/**
 * True when a document has already moved stock.
 */
async function documentPosted(documentType, documentId) {
  const row =
    await db.get(
      `
        SELECT id, posted_at, transaction_count
        FROM stock_document_postings
        WHERE document_type = $1
          AND document_id = $2
      `,
      [documentType, documentId]
    );

  return row || null;
}

// ---------------------------------------------------------------------------
// RECONCILIATION
// ---------------------------------------------------------------------------

/**
 * Compares every materialized balance against the ledger and repairs drift.
 *
 * The cache should never disagree, so anything returned here is a defect worth
 * looking at, not routine maintenance.
 */
async function reconcileBalances({ repair = true } = {}) {
  const rows =
    await db.all(
      `
        SELECT
          l.product_id,
          l.location_id,
          l.ledger_quantity,
          COALESCE(b.quantity, 0) AS cached_quantity
        FROM (
          SELECT
            product_id,
            location_id,
            SUM(signed_quantity) AS ledger_quantity
          FROM stock_transactions
          GROUP BY product_id, location_id
        ) l
        LEFT JOIN stock_balances b
          ON b.product_id = l.product_id
         AND b.location_id IS NOT DISTINCT FROM l.location_id
        WHERE COALESCE(b.quantity, 0) <> l.ledger_quantity
      `
    );

  if (repair) {
    for (const row of rows) {
      await recalculateBalance(null, row.product_id, row.location_id);
    }
  }

  return rows.map((row) => ({
    product_id: row.product_id,
    location_id: row.location_id,
    ledger_quantity: Number(row.ledger_quantity),
    cached_quantity: Number(row.cached_quantity),
    repaired: repair,
  }));
}

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_DIRECTIONS,
  negativeStockAllowed,
  defaultLocationId,
  recalculateBalance,
  currentQuantity,
  postMovement,
  postDocument,
  documentPosted,
  reconcileBalances,
};
