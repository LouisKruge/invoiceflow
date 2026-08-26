const express = require('express');

const db = require('../db');

const {
  requireAuth
} = require('../middleware/auth');

const {
  buildInvoiceWorkbook
} = require('../services/exportExcel');

const router = express.Router();

// ---------------------------------------------------------------------------
// FETCH INVOICES
// ---------------------------------------------------------------------------

async function fetchInvoiceRowsForExport(
  ids,
  dateFrom,
  dateTo
) {
  let sql = `
    SELECT
      i.invoice_number,
      i.supplier_name,
      i.supplier_vat_number,
      i.invoice_date,
      i.due_date,
      i.purchase_order_number,
      i.subtotal,
      i.vat_amount,
      i.total_amount,
      i.currency,
      i.payment_terms,
      i.status,
      u.name AS processed_by_name,
      i.processed_at,
      i.id
    FROM invoices i

    LEFT JOIN users u
      ON u.id = i.processed_by

    WHERE 1=1
  `;

  const params = [];

  if (
    Array.isArray(ids) &&
    ids.length
  ) {
    const placeholders =
      ids.map(
        (_, index) =>
          `$${params.length + index + 1}`
      ).join(', ');

    sql += `
      AND i.id IN (${placeholders})
    `;

    params.push(...ids);
  }

  if (dateFrom) {
    params.push(dateFrom);

    sql += `
      AND i.invoice_date::date >= $${params.length}
    `;
  }

  if (dateTo) {
    params.push(dateTo);

    sql += `
      AND i.invoice_date::date <= $${params.length}
    `;
  }

  sql += `
    ORDER BY i.created_at DESC
  `;

  return db.all(
    sql,
    params
  );
}

// ---------------------------------------------------------------------------
// FETCH LINE ITEMS
// ---------------------------------------------------------------------------

async function fetchLineItems(
  invoiceIds
) {
  if (!invoiceIds.length) {
    return [];
  }

  const placeholders =
    invoiceIds
      .map(
        (_, index) =>
          `$${index + 1}`
      )
      .join(', ');

  return db.all(
    `
      SELECT
        li.description,
        li.quantity,
        li.unit_price,
        li.vat,
        li.total,
        i.invoice_number,
        i.supplier_name

      FROM invoice_line_items li

      JOIN invoices i
        ON i.id = li.invoice_id

      WHERE li.invoice_id IN (${placeholders})
    `,
    invoiceIds
  );
}

// ---------------------------------------------------------------------------
// BUILD WORKBOOK
// ---------------------------------------------------------------------------

async function respondWithWorkbook(
  res,
  invoices,
  filenamePrefix
) {
  const ids =
    invoices.map(
      invoice => invoice.id
    );

  const lineItems =
    await fetchLineItems(ids);

  const wb =
    await buildInvoiceWorkbook(
      invoices,
      lineItems
    );

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filenamePrefix}-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx"`
  );

  await wb.xlsx.write(res);

  res.end();
}

// ---------------------------------------------------------------------------
// EXPORT ALL
// ---------------------------------------------------------------------------

router.get(
  '/all',
  requireAuth,
  async (req, res) => {
    try {
      const invoices =
        await fetchInvoiceRowsForExport(
          null,
          null,
          null
        );

      await respondWithWorkbook(
        res,
        invoices,
        'invoiceflow-export'
      );

    } catch (error) {
      console.error(
        '[export/all]',
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error:
            'Unable to export invoices'
        });
      }
    }
  }
);

// ---------------------------------------------------------------------------
// EXPORT SELECTED
// ---------------------------------------------------------------------------

router.post(
  '/selected',
  requireAuth,
  async (req, res) => {
    try {
      const { ids } =
        req.body;

      if (
        !Array.isArray(ids) ||
        !ids.length
      ) {
        return res.status(400).json({
          error:
            'No invoices selected'
        });
      }

      const invoices =
        await fetchInvoiceRowsForExport(
          ids,
          null,
          null
        );

      await respondWithWorkbook(
        res,
        invoices,
        'invoiceflow-selected'
      );

    } catch (error) {
      console.error(
        '[export/selected]',
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error:
            'Unable to export selected invoices'
        });
      }
    }
  }
);

// ---------------------------------------------------------------------------
// EXPORT RANGE
// ---------------------------------------------------------------------------

router.get(
  '/range',
  requireAuth,
  async (req, res) => {
    try {
      const {
        from,
        to
      } = req.query;

      if (!from || !to) {
        return res.status(400).json({
          error:
            'from and to query params are required (YYYY-MM-DD)'
        });
      }

      const invoices =
        await fetchInvoiceRowsForExport(
          null,
          from,
          to
        );

      await respondWithWorkbook(
        res,
        invoices,
        'invoiceflow-range'
      );

    } catch (error) {
      console.error(
        '[export/range]',
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error:
            'Unable to export invoice range'
        });
      }
    }
  }
);

module.exports = router;
