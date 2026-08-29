// services/invoiceStock.js
//
// Turns an approved invoice into stock receipts.
//
// An invoice is a purchasing event. Its line items become PURCHASE_RECEIPT
// movements — but only once the invoice has actually been approved, and only
// for lines whose product could be identified confidently. Anything the matcher
// is unsure about goes to the review queue rather than being guessed into the
// ledger, because a wrong match silently corrupts an inventory figure that
// people make purchasing decisions from.

const { v4: uuid } = require('uuid');

const db = require('../db');

const ledger = require('./stockLedger');
const matching = require('./productMatching');

const DOCUMENT_TYPE = 'INVOICE';

/**
 * Matches an invoice's line items and posts the confident ones to the ledger.
 *
 * Safe to call more than once: the ledger's document-posting gate means a
 * second call for the same invoice adds nothing.
 *
 * @param {string} invoiceId
 * @param {string} userId - who approved it
 * @returns {Promise<object>} what was posted, queued and skipped
 */
async function postInvoiceToStock(invoiceId, userId) {
  const invoice =
    await db.get('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  if (!invoice) {
    return { posted: false, reason: 'invoice_not_found' };
  }

  // Stock moves on approval, never on upload.
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

  const lineItems =
    await db.all(
      `
        SELECT * FROM invoice_line_items
        WHERE invoice_id = $1
        ORDER BY id
      `,
      [invoiceId]
    );

  if (!lineItems.length) {
    return { posted: false, reason: 'no_line_items' };
  }

  const locationId = await ledger.defaultLocationId(null);

  const movements = [];
  const queued = [];
  const skipped = [];

  for (const line of lineItems) {

    const quantity = Number(line.quantity || 0);

    // A line with no usable quantity is a subtotal, a note or a bad read.
    if (!Number.isFinite(quantity) || quantity <= 0) {
      skipped.push({
        line_id: line.id,
        description: line.description,
        reason: 'no_quantity',
      });

      continue;
    }

    if (!line.description || !String(line.description).trim()) {
      skipped.push({
        line_id: line.id,
        description: line.description,
        reason: 'no_description',
      });

      continue;
    }

    const result =
      await matching.matchProduct({
        description: line.description,
        supplier_id: invoice.supplier_id,
        limit: 5,
      });

    if (result.auto && result.match) {

      movements.push({
        product_id: result.match.id,
        location_id: locationId,
        transaction_type: 'PURCHASE_RECEIPT',
        quantity,
        unit_cost: line.unit_price ?? null,
        supplier_id: invoice.supplier_id || null,
        source_line_id: line.id,
        reason: `Received on invoice ${invoice.invoice_number || invoiceId}`,
        match_confidence: result.confidence,
        created_by: userId || null,
      });

      // Remember the match on the line so the invoice can be re-examined
      // later without re-running the matcher.
      await db.run(
        `
          UPDATE invoice_line_items
          SET product_id = $1,
              match_confidence = $2,
              match_method = $3
          WHERE id = $4
        `,
        [result.match.id, result.confidence, result.method, line.id]
      );

      continue;
    }

    // Not confident enough. Park it with its candidates for a person to decide.
    queued.push({
      line,
      candidates: result.candidates,
      confidence: result.confidence,
    });
  }

  const posting =
    movements.length
      ? await ledger.postDocument({
          documentType: DOCUMENT_TYPE,
          documentId: invoiceId,
          movements,
          postedBy: userId,
        })
      : { posted: false, reason: 'no_confident_matches', transactions: [] };

  for (const item of queued) {
    await db.run(
      `
        INSERT INTO stock_review_queue (
          id, source_document_type, source_document_id, source_line_id,
          raw_description, quantity, unit_cost, supplier_id, location_id,
          candidates, best_confidence
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
      `,
      [
        uuid(),
        DOCUMENT_TYPE,
        invoiceId,
        item.line.id,
        item.line.description,
        Number(item.line.quantity || 0),
        item.line.unit_price ?? null,
        invoice.supplier_id || null,
        locationId,
        JSON.stringify(
          (item.candidates || []).map((candidate) => ({
            product_id: candidate.product.id,
            sku: candidate.product.sku,
            description: candidate.product.description,
            confidence: Math.round(candidate.confidence * 1000) / 1000,
            method: candidate.method,
          }))
        ),
        item.confidence,
      ]
    );
  }

  return {
    posted: posting.posted,
    reason: posting.reason || null,
    transactions: posting.transactions || [],
    posted_count: (posting.transactions || []).length,
    queued_count: queued.length,
    skipped_count: skipped.length,
    skipped,
  };
}

module.exports = {
  DOCUMENT_TYPE,
  postInvoiceToStock,
};
