const express = require('express');

const db = require('../db');

const {
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/suppliers
//
// Suppliers with their spend position. Rejected invoices are excluded from
// every money figure so the totals match what the business actually owes.
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  async (req, res) => {

    try {

      const suppliers =
        await db.all(
          `
            SELECT
              s.*,

              (
                SELECT COUNT(*)
                FROM invoices i
                WHERE i.supplier_id = s.id
              ) AS invoice_count,

              (
                SELECT COALESCE(
                  SUM(i.total_amount),
                  0
                )
                FROM invoices i
                WHERE i.supplier_id = s.id
                  AND i.status != 'rejected'
              ) AS total_spend,

              (
                SELECT AVG(i.total_amount)
                FROM invoices i
                WHERE i.supplier_id = s.id
                  AND i.status != 'rejected'
                  AND i.total_amount IS NOT NULL
              ) AS average_invoice,

              (
                SELECT MAX(i.created_at)
                FROM invoices i
                WHERE i.supplier_id = s.id
              ) AS last_invoice_at,

              (
                SELECT COUNT(*)
                FROM invoices i
                WHERE i.supplier_id = s.id
                  AND i.status IN ('exception', 'duplicate')
              ) AS exception_count,

              (
                SELECT MAX(i.account_code)
                FROM invoices i
                WHERE i.supplier_id = s.id
                  AND i.account_code IS NOT NULL
              ) AS account_code

            FROM suppliers s

            ORDER BY s.name
          `
        );

      return res.json({
        suppliers
      });

    } catch (error) {

      console.error(
        '[suppliers]',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load suppliers.'
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/suppliers/:id
//
// One supplier's spend profile: totals, recent invoices and the month-by-month
// spend line the supplier detail screen draws.
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  requireAuth,
  async (req, res) => {

    try {

      const supplier =
        await db.get(
          `
            SELECT *
            FROM suppliers
            WHERE id = $1
          `,
          [req.params.id]
        );

      if (!supplier) {

        return res.status(404).json({
          error:
            'Supplier not found'
        });

      }

      const stats =
        await db.get(
          `
            SELECT
              COUNT(*)::int AS invoice_count,

              COALESCE(
                SUM(total_amount),
                0
              ) AS total_spend,

              AVG(total_amount) AS average_invoice,

              MAX(total_amount) AS largest_invoice,

              MIN(created_at) AS first_invoice_at,

              MAX(created_at) AS last_invoice_at

            FROM invoices
            WHERE supplier_id = $1
              AND status != 'rejected'
          `,
          [req.params.id]
        );

      const invoices =
        await db.all(
          `
            SELECT
              id,
              invoice_number,
              account_code,
              invoice_date,
              total_amount,
              currency,
              status,
              created_at
            FROM invoices
            WHERE supplier_id = $1
            ORDER BY created_at DESC
            LIMIT 25
          `,
          [req.params.id]
        );

      const trend =
        await db.all(
          `
            SELECT
              to_char(
                date_trunc('month', created_at),
                'YYYY-MM'
              ) AS month,

              COALESCE(
                SUM(total_amount),
                0
              ) AS total,

              COUNT(*)::int AS count

            FROM invoices
            WHERE supplier_id = $1
              AND status != 'rejected'
              AND created_at >= date_trunc(
                    'month',
                    CURRENT_DATE - INTERVAL '11 months'
                  )
            GROUP BY 1
            ORDER BY 1
          `,
          [req.params.id]
        );

      return res.json({

        supplier,

        stats: {
          invoice_count:
            Number(stats?.invoice_count || 0),

          total_spend:
            Number(stats?.total_spend || 0),

          average_invoice:
            stats?.average_invoice != null
              ? Number(stats.average_invoice)
              : null,

          largest_invoice:
            stats?.largest_invoice != null
              ? Number(stats.largest_invoice)
              : null,

          first_invoice_at:
            stats?.first_invoice_at || null,

          last_invoice_at:
            stats?.last_invoice_at || null
        },

        invoices,

        trend:
          trend.map(
            (row) => ({
              month: row.month,
              total: Number(row.total || 0),
              count: Number(row.count || 0)
            })
          )

      });

    } catch (error) {

      console.error(
        '[suppliers/detail]',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load supplier.'
      });
    }
  }
);

module.exports = router;
