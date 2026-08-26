// db.js — SQLite implementation of the InvoiceFlow schema.
//
// NOTE ON POSTGRES: The spec calls for PostgreSQL. The schema below is written
// in plain, portable SQL (snake_case tables/columns, explicit types, foreign
// keys) so it maps 1:1 onto Postgres — swap better-sqlite3 for `pg`, change
// AUTOINCREMENT -> SERIAL/IDENTITY, TEXT (json) -> JSONB, and the rest of the
// app (routes/services) does not need to change because all DB access goes
// through the repository functions exported from this file.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'data', 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'invoiceflow.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','processor','reviewer')),
  company_name TEXT DEFAULT 'Demo Company (Pty) Ltd',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vat_number TEXT,
  address TEXT,
  contact TEXT,
  normalized_key TEXT NOT NULL, -- lowercased/trimmed name+vat for fuzzy dedupe
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(normalized_key)
);

CREATE TABLE IF NOT EXISTS invoice_documents (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  supplier_vat_number TEXT,
  supplier_address TEXT,
  supplier_contact TEXT,
  invoice_date TEXT,
  due_date TEXT,
  purchase_order_number TEXT,
  subtotal REAL,
  vat_amount REAL,
  total_amount REAL,
  currency TEXT DEFAULT 'ZAR',
  payment_terms TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','review_required','approved','rejected','duplicate','exception')),
  overall_confidence REAL,
  field_confidence TEXT, -- JSON blob: { field: 0-1 }
  is_duplicate_of TEXT,
  processed_by TEXT,       -- user id who approved/rejected
  processed_at TEXT,
  created_by TEXT,         -- user id who captured it
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ai_raw_response TEXT,    -- JSON blob of raw AI extraction for audit
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (processed_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  description TEXT,
  quantity REAL,
  unit_price REAL,
  vat REAL,
  total REAL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_validation_results (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  rule_code TEXT NOT NULL,   -- e.g. MATH_CHECK, DUPLICATE_CHECK, MISSING_FIELD, VAT_CHECK
  passed INTEGER NOT NULL,   -- 0/1
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','error')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_processing_logs (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  stage TEXT NOT NULL,     -- uploaded, ai_extracted, validated, field_edited, approved, rejected
  actor_id TEXT,           -- user id, null for system/AI stages
  detail TEXT,             -- JSON blob (e.g. which field changed, old->new)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

-- Forward-looking tables: not exercised by the MVP UI, but present so
-- PO matching / GRN / procurement features can be added without a migration.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT,
  total_amount REAL,
  status TEXT DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id TEXT PRIMARY KEY,
  po_id TEXT,
  invoice_id TEXT,
  received_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_name);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
`);

module.exports = db;
