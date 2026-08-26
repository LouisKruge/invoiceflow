const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', requireAuth, (req, res) => {
  const today = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE date(created_at) = date('now')`).get().c;
  const processed = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE date(created_at) = date('now') AND status IN ('approved','rejected')`).get().c;
  const awaitingReview = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE status = 'review_required'`).get().c;
  const exceptions = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE status IN ('exception','duplicate')`).get().c;
  const totalValue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) v FROM invoices WHERE date(created_at) = date('now') AND status != 'rejected'`).get().v;

  // Average processing time: uploaded -> approved/rejected, from the logs table.
  const timings = db.prepare(`
    SELECT i.id,
      (julianday(i.processed_at) - julianday(i.created_at)) * 86400 as seconds
    FROM invoices i
    WHERE i.processed_at IS NOT NULL AND date(i.created_at) = date('now')
  `).all();
  const avgSeconds = timings.length
    ? Math.round(timings.reduce((a, b) => a + b.seconds, 0) / timings.length)
    : null;

  const recent = db.prepare(`
    SELECT id, invoice_number, supplier_name, total_amount, status, overall_confidence, created_at
    FROM invoices ORDER BY created_at DESC LIMIT 10
  `).all();

  res.json({
    today_invoices: today,
    processed,
    awaiting_review: awaitingReview,
    exceptions,
    total_invoice_value: totalValue,
    avg_processing_seconds: avgSeconds,
    recent_invoices: recent,
  });
});

module.exports = router;
