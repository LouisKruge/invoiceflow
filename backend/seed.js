// seed.js — creates demo users and a handful of historical invoices so the
// dashboard, search, and export screens have realistic data on first run.
// Callable directly (`npm run seed`) or required as a module — server.js
// calls runSeed() automatically on first boot if the users table is empty.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./db');

function upsertUser(name, email, password, role) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const id = uuid();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)`)
    .run(id, name, email, bcrypt.hashSync(password, 10), role);
  return id;
}

function findOrCreateSupplier(name, vat, address, contact) {
  const key = `${name.trim().toLowerCase()}|${(vat || '').trim().toLowerCase()}`;
  const existing = db.prepare('SELECT id FROM suppliers WHERE normalized_key = ?').get(key);
  if (existing) return existing.id;
  const id = uuid();
  db.prepare(`INSERT INTO suppliers (id, name, vat_number, address, contact, normalized_key) VALUES (?,?,?,?,?,?)`)
    .run(id, name, vat, address, contact, key);
  return id;
}

const sampleInvoices = [
  { num: 'INV-45821', supplier: 'ABC Industrial Supplies', vat: '4123456789', subtotal: 8500, vatAmt: 1275, total: 9775, status: 'approved', conf: 0.98, daysAgo: 0 },
  { num: 'INV-45822', supplier: 'XYZ Parts & Fasteners', vat: '4987654321', subtotal: 12347.83, vatAmt: 1852.17, total: 14200, status: 'review_required', conf: 0.74, daysAgo: 0 },
  { num: 'INV-45810', supplier: 'Highveld Electrical Wholesalers', vat: '4650912837', subtotal: 3200, vatAmt: 480, total: 3680, status: 'approved', conf: 0.97, daysAgo: 1 },
  { num: 'INV-45790', supplier: 'Coastal Packaging Solutions', vat: '4712398456', subtotal: 5100, vatAmt: 765, total: 5865, status: 'approved', conf: 0.95, daysAgo: 2 },
  { num: 'INV-45770', supplier: 'ABC Industrial Supplies', vat: '4123456789', subtotal: 2100, vatAmt: 315, total: 2415, status: 'exception', conf: 0.55, daysAgo: 3 },
];

function runSeed() {
  const adminId = upsertUser('Stefan van der Merwe', 'admin@invoiceflow.demo', 'admin123', 'admin');
  const processorId = upsertUser('Naledi Khumalo', 'processor@invoiceflow.demo', 'processor123', 'processor');
  const reviewerId = upsertUser('Johan Botha', 'reviewer@invoiceflow.demo', 'reviewer123', 'reviewer');

  console.log('Seeded demo users:');
  console.log('  admin@invoiceflow.demo     / admin123      (Admin)');
  console.log('  processor@invoiceflow.demo / processor123  (Processor)');
  console.log('  reviewer@invoiceflow.demo  / reviewer123   (Reviewer)');

  const already = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;
  if (already === 0) {
    for (const inv of sampleInvoices) {
      const supplierId = findOrCreateSupplier(inv.supplier, inv.vat, '', '');
      const id = uuid();
      const created = `datetime('now', '-${inv.daysAgo} days')`;
      db.prepare(`
        INSERT INTO invoices (
          id, invoice_number, supplier_id, supplier_name, supplier_vat_number, invoice_date, due_date,
          subtotal, vat_amount, total_amount, currency, payment_terms, status, overall_confidence,
          field_confidence, created_by, processed_by, processed_at, created_at, updated_at
        ) VALUES (?,?,?,?,?,date('now','-${inv.daysAgo} days'),date('now','-${inv.daysAgo - 30} days'),?,?,?,?,?,?,?,?,?,?,${inv.status === 'approved' ? "datetime('now','-" + inv.daysAgo + " days','+2 minutes')" : 'NULL'},${created},${created})
      `).run(
        id, inv.num, supplierId, inv.supplier, inv.vat, inv.subtotal, inv.vatAmt, inv.total, 'ZAR',
        '30 days from invoice date', inv.status, inv.conf, JSON.stringify({ total_amount: inv.conf, supplier_name: 0.99 }),
        processorId, inv.status === 'approved' ? reviewerId : null
      );
      db.prepare(`INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, vat, total) VALUES (?,?,?,?,?,?,?)`)
        .run(uuid(), id, 'Assorted goods per invoice', 1, inv.subtotal, inv.vatAmt, inv.total);
      db.prepare(`INSERT INTO invoice_validation_results (id, invoice_id, rule_code, passed, severity, message) VALUES (?,?,?,?,?,?)`)
        .run(uuid(), id, 'MATH_CHECK', 1, 'info', 'Subtotal + VAT matches total');
    }
    console.log(`Seeded ${sampleInvoices.length} sample invoices.`);
  } else {
    console.log('Invoices already exist — skipping sample invoice seed.');
  }
}

// Only auto-print/run when invoked directly (`node seed.js` / `npm run seed`).
// When required as a module (server.js on first boot) the caller decides
// whether to run it and doesn't need the console noise duplicated.
if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
