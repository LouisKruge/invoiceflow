const express = require('express');

const db = require('../db');
const {
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary
// ---------------------------------------------------------------------------

router.get(
  '/summary',
  requireAuth,
  async (req, res) => {
    try {
      const today = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE created_at::date = CURRENT_DATE
      `);

      const processed = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE created_at::date = CURRENT_DATE
          AND status IN ('approved', 'rejected')
      `);

      const awaitingReview = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE status = 'review_required'
      `);

      const exceptions = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE status IN ('exception', 'duplicate')
      `);

      const totalValue = await db.get(`
        SELECT COALESCE(
          SUM(total_amount),
          0
        ) AS v
        FROM invoices
        WHERE created_at::date = CURRENT_DATE
          AND status != 'rejected'
      `);

      const timings = await db.all(`
        SELECT
          EXTRACT(
            EPOCH FROM (
              processed_at - created_at
            )
          ) AS seconds
        FROM invoices
        WHERE processed_at IS NOT NULL
          AND created_at::date = CURRENT_DATE
      `);

      const avgSeconds =
        timings.length
          ? Math.round(
              timings.reduce(
                (sum, row) =>
                  sum + Number(row.seconds || 0),
                0
              ) / timings.length
            )
          : null;

      const recent = await db.all(`
        SELECT
          id,
          invoice_number,
          supplier_name,
          total_amount,
          status,
          overall_confidence,
          created_at
        FROM invoices
        ORDER BY created_at DESC
        LIMIT 10
      `);

      return res.json({
        today_invoices:
          Number(today?.c || 0),

        processed:
          Number(processed?.c || 0),

        awaiting_review:
          Number(awaitingReview?.c || 0),

        exceptions:
          Number(exceptions?.c || 0),

        total_invoice_value:
          Number(totalValue?.v || 0),

        avg_processing_seconds:
          avgSeconds,

        recent_invoices:
          recent
      });

    } catch (error) {
      console.error(
        '[dashboard/summary]',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load dashboard summary'
      });
    }
  }
);

module.exports = router;
