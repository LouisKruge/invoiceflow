const express = require('express');

const db = require('../db');

const {
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

router.get(
  '/summary',
  requireAuth,
  async (req, res) => {

    try {

      const todayResult =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM invoices
            WHERE created_at::date = CURRENT_DATE
          `
        );

      const processedResult =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM invoices
            WHERE created_at::date = CURRENT_DATE
              AND status IN ('approved', 'rejected')
          `
        );

      const awaitingResult =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM invoices
            WHERE status = 'review_required'
          `
        );

      const exceptionsResult =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM invoices
            WHERE status IN ('exception', 'duplicate')
          `
        );

      const totalValueResult =
        await db.get(
          `
            SELECT
              COALESCE(
                SUM(total_amount),
                0
              ) AS v
            FROM invoices
            WHERE created_at::date = CURRENT_DATE
              AND status != 'rejected'
          `
        );

      const avgProcessingResult =
        await db.get(
          `
            SELECT
              ROUND(
                AVG(
                  EXTRACT(
                    EPOCH FROM (
                      processed_at - created_at
                    )
                  )
                )
              )::int AS seconds
            FROM invoices
            WHERE processed_at IS NOT NULL
              AND created_at::date = CURRENT_DATE
          `
        );

      const recent =
        await db.all(
          `
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
          `
        );

      return res.json({

        today_invoices:
          Number(todayResult?.c || 0),

        processed:
          Number(processedResult?.c || 0),

        awaiting_review:
          Number(awaitingResult?.c || 0),

        exceptions:
          Number(exceptionsResult?.c || 0),

        total_invoice_value:
          Number(totalValueResult?.v || 0),

        avg_processing_seconds:
          avgProcessingResult?.seconds !== null
            ? Number(avgProcessingResult.seconds)
            : null,

        recent_invoices:
          recent
      });

    } catch (error) {

      console.error(
        '[dashboard]',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load dashboard.'
      });
    }
  }
);

module.exports = router;
