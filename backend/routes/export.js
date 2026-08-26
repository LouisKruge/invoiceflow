const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildInvoiceWorkbook } = require('../services/exportExcel');

const router = express.Router();

function fetchInvoiceRowsForExport(ids, dateFrom, dateTo) {
  let sql = `
    SELECT i.invoice_number, i.supplier_name, i.supplier_vat_number, i.invoice_date, i.due_date,
           i.purchase_order_number, i.subtotal, i.vat_amount, i.total_amount, i.currency, i.payment_terms,
           i.status, u.name as processed_by_name, i.processed_at, i.id
    FROM invoices i
    LEFT JOIN users u ON u.id = i.processed_by
    WHERE 1=1
  `;
  const params = [];
  if (ids && ids.length) {
    sql += ` AND i.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (dateFrom) { sql += ' AND date(i.invoice_date) >= date(?)'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND date(i.invoice_date) <= date(?)'; params.push(dateTo); }
  sql += ' ORDER BY i.created_at DESC';
  return db.prepare(sql).all(...params);
}

function fetchLineItems(invoiceIds) {
  if (!invoiceIds.length) return [];
  const rows = db.prepare(`
    SELECT li.description, li.quantity, li.unit_price, li.vat, li.total, i.invoice_number, i.supplier_name
    FROM invoice_line_items li JOIN invoices i ON i.id = li.invoice_id
    WHERE li.invoice_id IN (${invoiceIds.map(() => '?').join(',')})
  `).all(...invoiceIds);
  return rows;
}

async function respondWithWorkbook(res, invoices, filenamePrefix) {
  const ids = invoices.map(i => i.id);
  const lineItems = fetchLineItems(ids);
  const wb = await buildInvoiceWorkbook(invoices, lineItems);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// Export everything
router.get('/all', requireAuth, async (req, res) => {
  const invoices = fetchInvoiceRowsForExport(null, null, null);
  await respondWithWorkbook(res, invoices, 'invoiceflow-export');
});

// Export a specific selection of invoice IDs
router.post('/selected', requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No invoices selected' });
  const invoices = fetchInvoiceRowsForExport(ids, null, null);
  await respondWithWorkbook(res, invoices, 'invoiceflow-selected');
});

// Export a date range
router.get('/range', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to query params are required (YYYY-MM-DD)' });
  const invoices = fetchInvoiceRowsForExport(null, from, to);
  await respondWithWorkbook(res, invoices, 'invoiceflow-range');
});

module.exports = router;
