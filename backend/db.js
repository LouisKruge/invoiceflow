// server/db.js
//
// InvoiceFlow SQLite database
//
// PRODUCTION NOTES
//
// On Render:
//
//   RENDER_DISK_PATH=/data
//
// The database will then be stored at:
//
//   /data/db/invoiceflow.sqlite
//
// Uploaded invoice documents should also be stored under:
//
//   /data/uploads
//
// If RENDER_DISK_PATH is not configured, the application falls back to:
//
//   ./data
//
// This fallback is useful for local development.
//
// IMPORTANT:
// This file DOES NOT delete or reset existing data.
//

const path = require('path');
const fs = require('fs');

const Database =
  require('better-sqlite3');

// ---------------------------------------------------------------------------
// PERSISTENT STORAGE LOCATION
// ---------------------------------------------------------------------------

const DATA_ROOT =
  process.env.RENDER_DISK_PATH ||
  process.env.DATA_DIR ||
  path.join(
    __dirname,
    'data'
  );

// ---------------------------------------------------------------------------
// DIRECTORIES
// ---------------------------------------------------------------------------

const DB_DIR =
  path.join(
    DATA_ROOT,
    'db'
  );

const UPLOADS_DIR =
  path.join(
    DATA_ROOT,
    'uploads'
  );

fs.mkdirSync(
  DB_DIR,
  {
    recursive: true,
  }
);

fs.mkdirSync(
  UPLOADS_DIR,
  {
    recursive: true,
  }
);

// ---------------------------------------------------------------------------
// DATABASE PATH
// ---------------------------------------------------------------------------

const DB_PATH =
  path.join(
    DB_DIR,
    'invoiceflow.sqlite'
  );

console.log(
  `[db] Data root: ${DATA_ROOT}`
);

console.log(
  `[db] Database: ${DB_PATH}`
);

console.log(
  `[db] Uploads: ${UPLOADS_DIR}`
);

// ---------------------------------------------------------------------------
// OPEN DATABASE
// ---------------------------------------------------------------------------

const db =
  new Database(
    DB_PATH
  );

// ---------------------------------------------------------------------------
// SQLITE SETTINGS
// ---------------------------------------------------------------------------

db.pragma(
  'journal_mode = WAL'
);

db.pragma(
  'foreign_keys = ON'
);

db.pragma(
  'busy_timeout = 5000'
);

// ---------------------------------------------------------------------------
// SCHEMA
// ---------------------------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,

  email TEXT NOT NULL UNIQUE,

  password_hash TEXT NOT NULL,

  role TEXT NOT NULL
    CHECK(
      role IN (
        'admin',
        'processor',
        'reviewer'
      )
    ),

  company_name TEXT
    DEFAULT 'InvoiceFlow Company',

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    )
);


CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,

  vat_number TEXT,

  address TEXT,

  contact TEXT,

  normalized_key TEXT NOT NULL,

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  UNIQUE(
    normalized_key
  )
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

  currency TEXT
    DEFAULT 'ZAR',

  payment_terms TEXT,

  status TEXT NOT NULL
    DEFAULT 'processing'

    CHECK(
      status IN (
        'processing',
        'review_required',
        'approved',
        'rejected',
        'duplicate',
        'exception'
      )
    ),

  overall_confidence REAL,

  field_confidence TEXT,

  is_duplicate_of TEXT,

  processed_by TEXT,

  processed_at TEXT,

  created_by TEXT,

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  updated_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  ai_raw_response TEXT,

  FOREIGN KEY (
    supplier_id
  )
    REFERENCES suppliers(id),

  FOREIGN KEY (
    processed_by
  )
    REFERENCES users(id),

  FOREIGN KEY (
    created_by
  )
    REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS invoice_documents (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  file_path TEXT NOT NULL,

  original_filename TEXT,

  mime_type TEXT,

  uploaded_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  FOREIGN KEY (
    invoice_id
  )
    REFERENCES invoices(id)
    ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  description TEXT,

  quantity REAL,

  unit_price REAL,

  vat REAL,

  total REAL,

  FOREIGN KEY (
    invoice_id
  )
    REFERENCES invoices(id)
    ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS invoice_validation_results (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  rule_code TEXT NOT NULL,

  passed INTEGER NOT NULL,

  severity TEXT NOT NULL

    CHECK(
      severity IN (
        'info',
        'warning',
        'error'
      )
    ),

  message TEXT,

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  FOREIGN KEY (
    invoice_id
  )
    REFERENCES invoices(id)
    ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS invoice_processing_logs (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  stage TEXT NOT NULL,

  actor_id TEXT,

  detail TEXT,

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  FOREIGN KEY (
    invoice_id
  )
    REFERENCES invoices(id)
    ON DELETE CASCADE,

  FOREIGN KEY (
    actor_id
  )
    REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,

  po_number TEXT NOT NULL UNIQUE,

  supplier_id TEXT,

  total_amount REAL,

  status TEXT
    DEFAULT 'open',

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  FOREIGN KEY (
    supplier_id
  )
    REFERENCES suppliers(id)
);


CREATE TABLE IF NOT EXISTS goods_received_notes (
  id TEXT PRIMARY KEY,

  po_id TEXT,

  invoice_id TEXT,

  received_date TEXT,

  created_at TEXT NOT NULL
    DEFAULT (
      datetime('now')
    ),

  FOREIGN KEY (
    po_id
  )
    REFERENCES purchase_orders(id),

  FOREIGN KEY (
    invoice_id
  )
    REFERENCES invoices(id)
);


CREATE INDEX IF NOT EXISTS
  idx_invoices_status
ON invoices(status);


CREATE INDEX IF NOT EXISTS
  idx_invoices_supplier
ON invoices(supplier_name);


CREATE INDEX IF NOT EXISTS
  idx_invoices_number
ON invoices(invoice_number);


CREATE INDEX IF NOT EXISTS
  idx_invoices_created
ON invoices(created_at);


CREATE INDEX IF NOT EXISTS
  idx_invoice_documents_invoice
ON invoice_documents(invoice_id);


CREATE INDEX IF NOT EXISTS
  idx_invoice_lines_invoice
ON invoice_line_items(invoice_id);


CREATE INDEX IF NOT EXISTS
  idx_validation_invoice
ON invoice_validation_results(invoice_id);


CREATE INDEX IF NOT EXISTS
  idx_processing_logs_invoice
ON invoice_processing_logs(invoice_id);
`);

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

module.exports = db;

// Also expose storage locations for routes/services that need them.
//
// Example:
//
// const { UPLOADS_DIR } = require('../db');

module.exports.DB_PATH =
  DB_PATH;

module.exports.DATA_ROOT =
  DATA_ROOT;

module.exports.UPLOADS_DIR =
  UPLOADS_DIR;
