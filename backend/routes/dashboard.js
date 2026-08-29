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

      // -----------------------------------------------------------------------
      // OUTSTANDING
      //
      // Everything captured but not yet approved or rejected — the money the
      // business still has to make a decision about.
      // -----------------------------------------------------------------------

      const outstanding = await db.get(`
        SELECT
          COALESCE(SUM(total_amount), 0) AS v,
          COUNT(*)::int AS c
        FROM invoices
        WHERE status NOT IN ('approved', 'rejected')
      `);

      // -----------------------------------------------------------------------
      // MONTH TO DATE / PREVIOUS MONTH
      // -----------------------------------------------------------------------

      const monthSpend = await db.get(`
        SELECT
          COALESCE(SUM(total_amount), 0) AS v,
          COUNT(*)::int AS c
        FROM invoices
        WHERE created_at >= date_trunc('month', CURRENT_DATE)
          AND status != 'rejected'
      `);

      const previousMonthSpend = await db.get(`
        SELECT COALESCE(SUM(total_amount), 0) AS v
        FROM invoices
        WHERE created_at >= date_trunc(
                'month',
                CURRENT_DATE - INTERVAL '1 month'
              )
          AND created_at < date_trunc('month', CURRENT_DATE)
          AND status != 'rejected'
      `);

      const currentMonthValue =
        Number(monthSpend?.v || 0);

      const previousMonthValue =
        Number(previousMonthSpend?.v || 0);

      const monthChangePct =
        previousMonthValue > 0
          ? Math.round(
              ((currentMonthValue - previousMonthValue) /
                previousMonthValue) * 1000
            ) / 10
          : null;

      // -----------------------------------------------------------------------
      // PROCESSING QUEUE
      // -----------------------------------------------------------------------

      const inFlight = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE status IN ('processing', 'review_required')
      `);

      const inFlightToday = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE status IN ('processing', 'review_required')
          AND created_at::date = CURRENT_DATE
      `);

      const criticalExceptions = await db.get(`
        SELECT COUNT(*)::int AS c
        FROM invoices
        WHERE status = 'duplicate'
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
          account_code,
          total_amount,
          currency,
          status,
          overall_confidence,
          created_at
        FROM invoices
        ORDER BY created_at DESC
        LIMIT 10
      `);

      // -----------------------------------------------------------------------
      // NEEDS ATTENTION
      //
      // The invoices a person actually has to deal with, each paired with the
      // failed validation rule that explains why — so the dashboard can say
      // what is wrong rather than just that something is.
      // -----------------------------------------------------------------------

      const needsAttention = await db.all(`
        SELECT
          i.id,
          i.invoice_number,
          i.supplier_name,
          i.account_code,
          i.total_amount,
          i.currency,
          i.status,
          i.created_at,
          (
            SELECT v.message
            FROM invoice_validation_results v
            WHERE v.invoice_id = i.id
              AND v.passed = 0
            ORDER BY
              CASE v.severity
                WHEN 'error' THEN 0
                WHEN 'warning' THEN 1
                ELSE 2
              END,
              v.created_at
            LIMIT 1
          ) AS issue_message,
          (
            SELECT v.rule_code
            FROM invoice_validation_results v
            WHERE v.invoice_id = i.id
              AND v.passed = 0
            ORDER BY
              CASE v.severity
                WHEN 'error' THEN 0
                WHEN 'warning' THEN 1
                ELSE 2
              END,
              v.created_at
            LIMIT 1
          ) AS issue_rule,
          (
            SELECT v.severity
            FROM invoice_validation_results v
            WHERE v.invoice_id = i.id
              AND v.passed = 0
            ORDER BY
              CASE v.severity
                WHEN 'error' THEN 0
                WHEN 'warning' THEN 1
                ELSE 2
              END,
              v.created_at
            LIMIT 1
          ) AS issue_severity
        FROM invoices i
        WHERE i.status IN (
          'exception',
          'duplicate',
          'review_required'
        )
        ORDER BY
          CASE i.status
            WHEN 'duplicate' THEN 0
            WHEN 'exception' THEN 1
            ELSE 2
          END,
          i.created_at DESC
        LIMIT 8
      `);

      // -----------------------------------------------------------------------
      // SPEND TREND — last 6 months
      // -----------------------------------------------------------------------

      const spendTrend = await db.all(`
        SELECT
          to_char(
            date_trunc('month', created_at),
            'YYYY-MM'
          ) AS month,
          COALESCE(SUM(total_amount), 0) AS total,
          COUNT(*)::int AS count
        FROM invoices
        WHERE created_at >= date_trunc(
                'month',
                CURRENT_DATE - INTERVAL '5 months'
              )
          AND status != 'rejected'
        GROUP BY 1
        ORDER BY 1
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

        critical_exceptions:
          Number(criticalExceptions?.c || 0),

        total_invoice_value:
          Number(totalValue?.v || 0),

        outstanding_value:
          Number(outstanding?.v || 0),

        outstanding_count:
          Number(outstanding?.c || 0),

        month_spend:
          currentMonthValue,

        month_invoice_count:
          Number(monthSpend?.c || 0),

        month_change_pct:
          monthChangePct,

        processing_count:
          Number(inFlight?.c || 0),

        processing_today:
          Number(inFlightToday?.c || 0),

        avg_processing_seconds:
          avgSeconds,

        recent_invoices:
          recent,

        needs_attention:
          needsAttention,

        spend_trend:
          spendTrend.map(
            (row) => ({
              month: row.month,
              total: Number(row.total || 0),
              count: Number(row.count || 0)
            })
          )
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
