// services/exportExcel.js — Database -> Excel export.
const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  row.height = 20;
}

/**
 * @param {Array} invoices - rows from the invoices table (with supplier joined)
 * @param {Array} lineItemsByInvoice - [{invoice_number, ...lineItem}]
 */
async function buildInvoiceWorkbook(invoices, lineItemsByInvoice) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InvoiceFlow';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Invoices');
  sheet.columns = [
    { header: 'Invoice Number', key: 'invoice_number', width: 18 },
    { header: 'Supplier', key: 'supplier_name', width: 28 },
    { header: 'Supplier VAT Number', key: 'supplier_vat_number', width: 20 },
    { header: 'Invoice Date', key: 'invoice_date', width: 14 },
    { header: 'Due Date', key: 'due_date', width: 14 },
    { header: 'PO Number', key: 'purchase_order_number', width: 14 },
    { header: 'Subtotal', key: 'subtotal', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'VAT', key: 'vat_amount', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Total', key: 'total_amount', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Payment Terms', key: 'payment_terms', width: 24 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Processed By', key: 'processed_by_name', width: 18 },
    { header: 'Processed Date', key: 'processed_at', width: 18 },
  ];
  styleHeader(sheet.getRow(1));
  invoices.forEach(inv => sheet.addRow(inv));
  sheet.autoFilter = { from: 'A1', to: 'N1' };

  const liSheet = wb.addWorksheet('Line Items');
  liSheet.columns = [
    { header: 'Invoice Number', key: 'invoice_number', width: 18 },
    { header: 'Supplier', key: 'supplier_name', width: 28 },
    { header: 'Description', key: 'description', width: 36 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit Price', key: 'unit_price', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'VAT', key: 'vat', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Total', key: 'total', width: 14, style: { numFmt: '#,##0.00' } },
  ];
  styleHeader(liSheet.getRow(1));
  lineItemsByInvoice.forEach(li => liSheet.addRow(li));

  return wb;
}

module.exports = { buildInvoiceWorkbook };
