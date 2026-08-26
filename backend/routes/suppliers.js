const express = require('express');

const db = require('../db');

const {
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

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
              ) AS total_spend

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

module.exports = router;
