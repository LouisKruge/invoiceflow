// routes/stock.js
//
// The Stock module's HTTP surface. Follows the same conventions as the rest of
// InvoiceFlow: an Express router mounted by server.js, requireAuth on every
// route, requireRole on anything that changes inventory.
//
// Nothing here writes to stock_transactions directly — every movement goes
// through services/stockLedger so the balance cache, the negative-stock guard
// and the idempotency gate cannot be bypassed.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { v4: uuid } = require('uuid');

const db = require('../db');

const {
  requireAuth,
  requireRole,
} = require('../middleware/auth');

const ledger = require('../services/stockLedger');
const matching = require('../services/productMatching');
const importer = require('../services/stockImport');
const sheets = require('../services/stockSheet');
const binSeed = require('../services/binSeed');
const invoiceStock = require('../services/invoiceStock');
const ai = require('../services/aiExtraction');

const router = express.Router();

// ============================================================================
// UPLOADS
// ============================================================================

const IMPORT_DIR = path.join(__dirname, '..', 'data', 'stock-imports');

if (!fs.existsSync(IMPORT_DIR)) {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMPORT_DIR),
    filename: (req, file, cb) =>
      cb(null, `${uuid()}${path.extname(file.originalname) || '.xlsx'}`),
  }),

  limits: { fileSize: 15 * 1024 * 1024 },

  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
      'application/csv',
      'application/octet-stream',
    ];

    const extension = path.extname(file.originalname).toLowerCase();
    const extensionOk = ['.xlsx', '.xls', '.csv', '.tsv'].includes(extension);

    cb(
      allowed.includes(file.mimetype) || extensionOk
        ? null
        : new Error('Please upload an .xlsx or .csv file'),
      allowed.includes(file.mimetype) || extensionOk
    );
  },
});

// ============================================================================
// HELPERS
// ============================================================================

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;

  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/**
 * Derives the stock status the UI shows from quantity and reorder level.
 * Kept server-side so every screen agrees on what "low" means.
 */
function stockStatus(quantity, reorderLevel) {
  const qty = Number(quantity || 0);
  const reorder = Number(reorderLevel || 0);

  if (qty <= 0) return 'OUT_OF_STOCK';
  if (reorder > 0 && qty <= reorder) return 'LOW_STOCK';

  return 'IN_STOCK';
}

function decorateProduct(row) {
  const quantity = Number(row.current_quantity || 0);
  const unitCost = Number(row.unit_cost || 0);

  return {
    ...row,
    current_quantity: quantity,
    unit_cost: unitCost,
    reorder_level: Number(row.reorder_level || 0),
    inventory_value: Math.round(quantity * unitCost * 100) / 100,
    stock_status: stockStatus(quantity, row.reorder_level),
  };
}

/**
 * Finds or creates a supplier by name, reusing the same normalized key the
 * invoice capture path uses so stock imports and invoices land on one record.
 */
async function findOrCreateSupplier(client, name) {
  if (!name || !String(name).trim()) return null;

  const runner = client || db;

  const clean = String(name).trim();
  const key = clean.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!key) return null;

  const existing =
    await runner.query(
      'SELECT id FROM suppliers WHERE normalized_key = $1',
      [key]
    );

  if (existing.rows.length) return existing.rows[0].id;

  const id = uuid();

  await runner.query(
    `
      INSERT INTO suppliers (id, name, normalized_key)
      VALUES ($1, $2, $3)
      ON CONFLICT (normalized_key) DO NOTHING
    `,
    [id, clean, key]
  );

  const after =
    await runner.query(
      'SELECT id FROM suppliers WHERE normalized_key = $1',
      [key]
    );

  return after.rows.length ? after.rows[0].id : null;
}

// The product list is assembled from the balance cache, but every figure it
// shows is reconcilable against stock_transactions.
const PRODUCT_SELECT = `
  SELECT
    p.*,
    COALESCE(b.quantity, 0) AS current_quantity,
    b.last_movement_at,
    s.name AS supplier_name,
    (
      SELECT COUNT(*)::int FROM product_bins pb WHERE pb.product_id = p.id
    ) AS bin_count
  FROM products p
  LEFT JOIN (
    SELECT product_id,
           SUM(quantity) AS quantity,
           MAX(last_movement_at) AS last_movement_at
    FROM stock_balances
    GROUP BY product_id
  ) b ON b.product_id = p.id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

// ============================================================================
// GET /api/stock/overview
// ============================================================================

router.get(
  '/overview',
  requireAuth,
  async (req, res) => {
    try {

      const totals =
        await db.get(
          `
            SELECT
              COUNT(*)::int AS total_products,
              COALESCE(SUM(q.quantity), 0) AS total_units,
              COALESCE(SUM(q.quantity * p.unit_cost), 0) AS total_value,
              COUNT(*) FILTER (
                WHERE q.quantity <= 0
              )::int AS out_of_stock,
              COUNT(*) FILTER (
                WHERE q.quantity > 0
                  AND p.reorder_level > 0
                  AND q.quantity <= p.reorder_level
              )::int AS low_stock
            FROM products p
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(quantity), 0) AS quantity
              FROM stock_balances b
              WHERE b.product_id = p.id
            ) q ON TRUE
            WHERE p.is_active = TRUE
          `
        );

      const movements =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM stock_transactions
            WHERE created_at >= NOW() - INTERVAL '7 days'
          `
        );

      const pendingReview =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM stock_review_queue
            WHERE status = 'pending'
          `
        );

      // A movement is easier to trust when the figure it left behind is beside
      // it. The balance is summed from the ledger up to and including that
      // movement, so it is what the product stood at afterwards rather than
      // what it stands at now.
      const recent =
        await db.all(
          `
            WITH scoped AS (
              SELECT
                t.*,
                p.sku,
                p.description AS product_description,
                u.name AS created_by_name
              FROM stock_transactions t
              JOIN products p ON p.id = t.product_id
              LEFT JOIN users u ON u.id = t.created_by
              ORDER BY t.created_at DESC, t.id DESC
              LIMIT 10
            )
            SELECT
              scoped.*,
              (
                SELECT COALESCE(SUM(prior.signed_quantity), 0)
                FROM stock_transactions prior
                WHERE prior.product_id = scoped.product_id
                  AND prior.location_id IS NOT DISTINCT FROM scoped.location_id
                  AND (prior.created_at, prior.id) <= (scoped.created_at, scoped.id)
              ) AS balance_after
            FROM scoped
            ORDER BY scoped.created_at DESC, scoped.id DESC
          `
        );

      return res.json({
        total_products: Number(totals?.total_products || 0),
        total_units: Number(totals?.total_units || 0),
        total_value: Number(totals?.total_value || 0),
        low_stock: Number(totals?.low_stock || 0),
        out_of_stock: Number(totals?.out_of_stock || 0),
        recent_movements: Number(movements?.c || 0),
        pending_review: Number(pendingReview?.c || 0),
        recent_transactions: recent,
      });

    } catch (error) {
      console.error('[stock/overview]', error);

      return res.status(500).json({
        error: `Unable to load stock overview: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/products
// ============================================================================

const SORTABLE = {
  sku: 'p.sku',
  description: 'p.description',
  category: 'p.category',
  quantity: 'COALESCE(b.quantity, 0)',
  unit_cost: 'p.unit_cost',
  value: 'COALESCE(b.quantity, 0) * p.unit_cost',
  last_movement: 'b.last_movement_at',
  created_at: 'p.created_at',
};

router.get(
  '/products',
  requireAuth,
  async (req, res) => {
    try {

      const {
        q,
        category,
        status,
        supplier_id: supplierId,
        include_inactive: includeInactive,
        group,
      } = req.query;

      const sort = SORTABLE[req.query.sort] || 'p.description';
      const order = String(req.query.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

      const limit = Math.min(Math.max(toNumber(req.query.limit, 50), 1), 200);
      const page = Math.max(toNumber(req.query.page, 1), 1);
      const offset = (page - 1) * limit;

      const params = [];
      let where = ' WHERE 1 = 1';

      if (String(includeInactive) !== '1') {
        where += ' AND p.is_active = TRUE';
      }

      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;

        // Search spans every identifier a person might have to hand.
        where += `
          AND (
            p.sku ILIKE ${p}
            OR p.product_code ILIKE ${p}
            OR p.description ILIKE ${p}
            OR p.supplier_product_code ILIKE ${p}
            OR p.barcode ILIKE ${p}
            OR p.bin_location ILIKE ${p}
            OR s.name ILIKE ${p}
          )
        `;
      }

      if (category) {
        params.push(category);
        where += ` AND p.category = $${params.length}`;
      }

      if (req.query.inventory_type) {
        params.push(String(req.query.inventory_type).toUpperCase());
        where += ` AND p.inventory_type = $${params.length}`;
      }

      if (group) {
        if (group === 'UNGROUPED') {
          where += " AND COALESCE(NULLIF(TRIM(p.stock_group), ''), '') = ''";
        } else {
          params.push(group);
          where += ` AND p.stock_group = $${params.length}`;
        }
      }

      if (supplierId) {
        params.push(supplierId);
        where += ` AND p.supplier_id = $${params.length}`;
      }

      if (status === 'OUT_OF_STOCK') {
        where += ' AND COALESCE(b.quantity, 0) <= 0';
      } else if (status === 'LOW_STOCK') {
        where += `
          AND COALESCE(b.quantity, 0) > 0
          AND p.reorder_level > 0
          AND COALESCE(b.quantity, 0) <= p.reorder_level
        `;
      } else if (status === 'IN_STOCK') {
        where += `
          AND COALESCE(b.quantity, 0) > 0
          AND (p.reorder_level <= 0 OR COALESCE(b.quantity, 0) > p.reorder_level)
        `;
      }

      const total =
        await db.get(
          `SELECT COUNT(*)::int AS c FROM (${PRODUCT_SELECT}${where}) x`,
          params
        );

      params.push(limit, offset);

      const rows =
        await db.all(
          `
            ${PRODUCT_SELECT}
            ${where}
            ORDER BY ${
              // Without a group chosen the lists stay whole down the pages,
              // rather than consumables and fittings alternating row by row.
              group ? '' : 'p.stock_group ASC NULLS LAST, '
            }${sort} ${order} NULLS LAST
            LIMIT $${params.length - 1} OFFSET $${params.length}
          `,
          params
        );

      const categories =
        await db.all(
          `
            SELECT DISTINCT category
            FROM products
            WHERE category IS NOT NULL AND category <> ''
            ORDER BY category
          `
        );

      // The store's own lists — consumables, fittings, electrical — with how
      // many products are in each, so the screen can offer them as the top
      // level rather than one undifferentiated table.
      const groups =
        await db.all(
          `
            SELECT
              COALESCE(NULLIF(TRIM(stock_group), ''), 'UNGROUPED') AS name,
              COUNT(*)::int AS product_count
            FROM products
            WHERE is_active = TRUE
            GROUP BY 1
            ORDER BY (COALESCE(NULLIF(TRIM(stock_group), ''), 'UNGROUPED') = 'UNGROUPED'), 1
          `
        );

      return res.json({
        products: rows.map(decorateProduct),
        total: Number(total?.c || 0),
        page,
        limit,
        pages: Math.max(1, Math.ceil(Number(total?.c || 0) / limit)),
        categories: categories.map((row) => row.category),
        groups,
      });

    } catch (error) {
      console.error('[stock/products]', error);

      return res.status(500).json({
        error: `Unable to load products: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/products
// ============================================================================

router.post(
  '/products',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const body = req.body || {};

      if (!body.description || !String(body.description).trim()) {
        return res.status(400).json({
          error: 'A product description is required',
        });
      }

      const supplierId =
        body.supplier_id ||
        (await findOrCreateSupplier(null, body.supplier_name));

      const id = uuid();

      const result =
        await db.run(
          `
            INSERT INTO products (
              id, sku, product_code, barcode, description,
              normalized_description, category, unit_of_measure,
              reorder_level, unit_cost, supplier_id, supplier_product_code,
              bin_location, stock_group, inventory_type, track_inventory,
              created_by
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            RETURNING *
          `,
          [
            id,
            body.sku || null,
            body.product_code || null,
            body.barcode || null,
            String(body.description).trim(),
            matching.normalizeDescription(body.description),
            body.category || null,
            body.unit_of_measure || 'ea',
            toNumber(body.reorder_level, 0),
            toNumber(body.unit_cost, 0),
            supplierId,
            body.supplier_product_code || null,
            body.bin_location ? String(body.bin_location).trim() : null,
            body.stock_group ? String(body.stock_group).trim() : null,

            // Stock unless told otherwise, because that is what a product
            // master is mostly for — but a service or a one-off can be
            // recorded here too, and will never take a receipt.
            body.inventory_type === 'NON_STOCK' ? 'NON_STOCK' : 'STOCK',

            body.inventory_type === 'NON_STOCK'
              ? false
              : body.track_inventory !== false && body.track_inventory !== 'false',

            req.user.id,
          ]
        );

      const product = result.rows[0];

      // An opening quantity supplied at creation is a ledger event, not a
      // column: it is posted so the product's history starts correctly.
      const openingQuantity = toNumber(body.opening_quantity, 0);

      if (openingQuantity > 0) {
        await ledger.postMovement(null, {
          product_id: product.id,
          transaction_type: 'OPENING_BALANCE',
          quantity: openingQuantity,
          unit_cost: toNumber(body.unit_cost, 0),
          reason: 'Opening balance captured with the product',
          created_by: req.user.id,
        });
      }

      return res.status(201).json({ product });

    } catch (error) {
      console.error('[stock/products/create]', error);

      return res.status(500).json({
        error: `Unable to create product: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/products/:id
// ============================================================================

router.get(
  '/products/:id',
  requireAuth,
  async (req, res) => {
    try {

      const product =
        await db.get(
          `${PRODUCT_SELECT} WHERE p.id = $1`,
          [req.params.id]
        );

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const byLocation =
        await db.all(
          `
            SELECT
              b.location_id,
              l.code AS location_code,
              l.name AS location_name,
              b.quantity,
              b.last_movement_at
            FROM stock_balances b
            LEFT JOIN stock_locations l ON l.id = b.location_id
            WHERE b.product_id = $1
            ORDER BY l.name
          `,
          [req.params.id]
        );

      // The cached figure is only trustworthy if it agrees with the ledger,
      // so the detail response states both and whether they match.
      const ledgerQuantity =
        await ledger.currentQuantity(null, req.params.id, null);

      return res.json({
        product: decorateProduct(product),
        balances_by_location: byLocation.map((row) => ({
          ...row,
          quantity: Number(row.quantity || 0),
        })),
        // Every bin the product occupies, not only the primary one shown in
        // the list — a sign-out sheet may name any of them.
        bins: await matching.binsForProduct(req.params.id),
        ledger_quantity: ledgerQuantity,
        reconciled:
          Number(product.current_quantity || 0) === ledgerQuantity,
      });

    } catch (error) {
      console.error('[stock/products/detail]', error);

      return res.status(500).json({
        error: `Unable to load product: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// PATCH /api/stock/products/:id
//
// Product attributes are editable. Quantity is not: it is derived from the
// ledger, so changing it means posting an adjustment.
// ============================================================================

const EDITABLE_PRODUCT_FIELDS = [
  'sku',
  'product_code',
  'barcode',
  'description',
  'category',
  'unit_of_measure',
  'reorder_level',
  'unit_cost',
  'supplier_id',
  'supplier_product_code',
  'bin_location',
  'stock_group',
  'inventory_type',
  'track_inventory',
  'is_active',
];

router.patch(
  '/products/:id',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const existing =
        await db.get('SELECT * FROM products WHERE id = $1', [req.params.id]);

      if (!existing) {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, 'current_quantity')
      ) {
        return res.status(400).json({
          error:
            'Stock quantity cannot be edited directly. Post a stock adjustment instead.',
        });
      }

      const updates = {};

      for (const field of EDITABLE_PRODUCT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
          updates[field] = req.body[field];
        }
      }

      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'No editable fields provided' });
      }

      // Keep the matching key in step with the description it derives from.
      if (updates.description) {
        updates.normalized_description =
          matching.normalizeDescription(updates.description);
      }

      const fields = Object.keys(updates);
      const values = Object.values(updates);

      values.push(req.params.id);

      await db.run(
        `
          UPDATE products
          SET ${fields.map((f, i) => `${f} = $${i + 1}`).join(', ')},
              updated_at = NOW()
          WHERE id = $${values.length}
        `,
        values
      );

      // A bin set by hand joins the product's set of bins, so a sign-out sheet
      // naming it resolves like any imported one.
      if (updates.bin_location) {
        await matching.rememberBin({
          productId: req.params.id,
          bin: updates.bin_location,
          source: 'manual',
          userId: req.user.id,
        });
      }

      const product =
        await db.get(`${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);

      return res.json({
        product: decorateProduct(product),
        bins: await matching.binsForProduct(req.params.id),
      });

    } catch (error) {
      console.error('[stock/products/update]', error);

      return res.status(500).json({
        error: `Unable to update product: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/products/:id/history
//
// The audit trail: why the quantity is what it is. Returns every movement with
// a running balance and a link back to the document that caused it.
// ============================================================================

router.get(
  '/products/:id/history',
  requireAuth,
  async (req, res) => {
    try {

      const product =
        await db.get(
          'SELECT id, sku, description, unit_of_measure FROM products WHERE id = $1',
          [req.params.id]
        );

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const rows =
        await db.all(
          `
            SELECT
              t.*,
              l.code AS location_code,
              l.name AS location_name,
              s.name AS supplier_name,
              u.name AS created_by_name,
              i.invoice_number,
              sh.sheet_number,
              SUM(t.signed_quantity) OVER (
                ORDER BY t.created_at, t.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS running_balance
            FROM stock_transactions t
            LEFT JOIN stock_locations l ON l.id = t.location_id
            LEFT JOIN suppliers s ON s.id = t.supplier_id
            LEFT JOIN users u ON u.id = t.created_by
            LEFT JOIN invoices i
              ON t.source_document_type = 'INVOICE'
             AND i.id = t.source_document_id
            LEFT JOIN stock_sheets sh
              ON t.source_document_type = 'STOCK_SHEET'
             AND sh.id = t.source_document_id
            WHERE t.product_id = $1
            ORDER BY t.created_at ASC, t.id ASC
          `,
          [req.params.id]
        );

      return res.json({
        product,
        transactions: rows.map((row) => ({
          ...row,
          quantity: Number(row.quantity),
          signed_quantity: Number(row.signed_quantity),
          running_balance: Number(row.running_balance),
        })),
        current_quantity: rows.length
          ? Number(rows[rows.length - 1].running_balance)
          : 0,
      });

    } catch (error) {
      console.error('[stock/products/history]', error);

      return res.status(500).json({
        error: `Unable to load product history: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/transactions
// ============================================================================

router.get(
  '/transactions',
  requireAuth,
  async (req, res) => {
    try {

      const {
        product_id: productId,
        type,
        location_id: locationId,
        source_document_type: sourceType,
        source_document_id: sourceId,
        q,
      } = req.query;

      const limit = Math.min(Math.max(toNumber(req.query.limit, 50), 1), 200);
      const page = Math.max(toNumber(req.query.page, 1), 1);
      const offset = (page - 1) * limit;

      const params = [];
      let where = ' WHERE 1 = 1';

      if (productId) {
        params.push(productId);
        where += ` AND t.product_id = $${params.length}`;
      }

      if (type) {
        params.push(type);
        where += ` AND t.transaction_type = $${params.length}`;
      }

      if (locationId) {
        params.push(locationId);
        where += ` AND t.location_id = $${params.length}`;
      }

      if (sourceType) {
        params.push(sourceType);
        where += ` AND t.source_document_type = $${params.length}`;
      }

      if (sourceId) {
        params.push(sourceId);
        where += ` AND t.source_document_id = $${params.length}`;
      }

      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;

        where += `
          AND (
            p.sku ILIKE ${p}
            OR p.description ILIKE ${p}
            OR p.bin_location ILIKE ${p}
            OR t.reason ILIKE ${p}
            OR t.employee_name ILIKE ${p}
            OR t.job_reference ILIKE ${p}
          )
        `;
      }

      const base = `
        FROM stock_transactions t
        JOIN products p ON p.id = t.product_id
        LEFT JOIN stock_locations l ON l.id = t.location_id
        LEFT JOIN suppliers s ON s.id = t.supplier_id
        LEFT JOIN users u ON u.id = t.created_by
        LEFT JOIN invoices i
          ON t.source_document_type = 'INVOICE'
         AND i.id = t.source_document_id
        LEFT JOIN stock_sheets sh
          ON t.source_document_type = 'STOCK_SHEET'
         AND sh.id = t.source_document_id
        ${where}
      `;

      const total = await db.get(`SELECT COUNT(*)::int AS c ${base}`, params);

      params.push(limit, offset);

      const rows =
        await db.all(
          `
            WITH scoped AS (
              SELECT
                t.*,
                p.sku,
                p.description AS product_description,
                p.unit_of_measure,
                l.code AS location_code,
                l.name AS location_name,
                s.name AS supplier_name,
                u.name AS created_by_name,
                i.invoice_number,
                sh.sheet_number
              ${base}
              ORDER BY t.created_at DESC, t.id DESC
              LIMIT $${params.length - 1} OFFSET $${params.length}
            )
            SELECT
              scoped.*,
              -- Summed over the whole ledger, not the filtered page, so a
              -- filter cannot make the running balance lie.
              (
                SELECT COALESCE(SUM(prior.signed_quantity), 0)
                FROM stock_transactions prior
                WHERE prior.product_id = scoped.product_id
                  AND prior.location_id IS NOT DISTINCT FROM scoped.location_id
                  AND (prior.created_at, prior.id) <= (scoped.created_at, scoped.id)
              ) AS balance_after
            FROM scoped
            ORDER BY scoped.created_at DESC, scoped.id DESC
          `,
          params
        );

      return res.json({
        transactions: rows,
        total: Number(total?.c || 0),
        page,
        limit,
        pages: Math.max(1, Math.ceil(Number(total?.c || 0) / limit)),
        types: ledger.TRANSACTION_TYPES,
      });

    } catch (error) {
      console.error('[stock/transactions]', error);

      return res.status(500).json({
        error: `Unable to load stock transactions: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/transactions/:id
// ============================================================================

router.get(
  '/transactions/:id',
  requireAuth,
  async (req, res) => {
    try {

      const row =
        await db.get(
          `
            SELECT
              t.*,
              p.sku,
              p.description AS product_description,
              p.unit_of_measure,
              l.code AS location_code,
              l.name AS location_name,
              s.name AS supplier_name,
              u.name AS created_by_name,
              i.invoice_number,
              sh.sheet_number,
              i.status AS invoice_status
            FROM stock_transactions t
            JOIN products p ON p.id = t.product_id
            LEFT JOIN stock_locations l ON l.id = t.location_id
            LEFT JOIN suppliers s ON s.id = t.supplier_id
            LEFT JOIN users u ON u.id = t.created_by
            LEFT JOIN invoices i
              ON t.source_document_type = 'INVOICE'
             AND i.id = t.source_document_id
            LEFT JOIN stock_sheets sh
              ON t.source_document_type = 'STOCK_SHEET'
             AND sh.id = t.source_document_id
            WHERE t.id = $1
          `,
          [req.params.id]
        );

      if (!row) {
        return res.status(404).json({ error: 'Stock transaction not found' });
      }

      const adjustment =
        await db.get(
          'SELECT * FROM stock_adjustments WHERE transaction_id = $1',
          [req.params.id]
        );

      // A movement that came off a sign-out sheet carries the sheet with it, so
      // the detail screen can open the document the deduction came from.
      const sheet =
        row.source_document_type === 'STOCK_SHEET'
          ? await db.get(
              `
                SELECT
                  id, sheet_number, filename, mime_type, status,
                  employee_name, job_reference, department, vehicle,
                  issue_date, posted_at
                FROM stock_sheets
                WHERE id = $1
              `,
              [row.source_document_id]
            )
          : null;

      return res.json({
        transaction: row,
        adjustment: adjustment || null,
        stock_sheet: sheet || null,
      });

    } catch (error) {
      console.error('[stock/transactions/detail]', error);

      return res.status(500).json({
        error: `Unable to load stock transaction: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/transactions
//
// A direct ledger post, for movements with no source document of their own
// (a stock count, a transfer, a manual receipt).
// ============================================================================

router.post(
  '/transactions',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const body = req.body || {};

      if (!body.product_id) {
        return res.status(400).json({ error: 'A product is required' });
      }

      if (!ledger.TRANSACTION_TYPES.includes(body.transaction_type)) {
        return res.status(400).json({
          error: `Transaction type must be one of: ${ledger.TRANSACTION_TYPES.join(', ')}`,
        });
      }

      const transaction =
        await ledger.postMovement(null, {
          product_id: body.product_id,
          location_id: body.location_id || null,
          transaction_type: body.transaction_type,
          direction: toNumber(body.direction, null),
          quantity: toNumber(body.quantity, 0),
          unit_cost: toNumber(body.unit_cost, null),
          supplier_id: body.supplier_id || null,
          employee_name: body.employee_name || null,
          job_reference: body.job_reference || null,
          reason: body.reason || null,
          notes: body.notes || null,
          source_document_type: body.source_document_type || null,
          source_document_id: body.source_document_id || null,
          source_line_id: body.source_line_id || null,
          created_by: req.user.id,
        });

      return res.status(201).json({ transaction });

    } catch (error) {
      console.error('[stock/transactions/create]', error);

      const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 400;

      return res.status(status).json({
        error: error.message,
        available: error.available,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/adjustments
//
// A correction. It never rewrites the quantity — it appends a signed movement
// and records who made it and why.
// ============================================================================

router.post(
  '/adjustments',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const body = req.body || {};

      const quantity = toNumber(body.quantity, 0);

      if (!body.product_id) {
        return res.status(400).json({ error: 'A product is required' });
      }

      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          error: 'Enter the adjustment amount as a positive number and choose increase or decrease',
        });
      }

      if (!body.reason || !String(body.reason).trim()) {
        return res.status(400).json({
          error: 'A reason is required for a stock adjustment',
        });
      }

      const direction =
        String(body.direction) === '-1' ||
        body.direction === -1 ||
        String(body.direction).toLowerCase() === 'decrease'
          ? -1
          : 1;

      const result =
        await db.transaction(async (client) => {

          const transaction =
            await ledger.postMovement(client, {
              product_id: body.product_id,
              location_id: body.location_id || null,
              transaction_type: 'STOCK_ADJUSTMENT',
              direction,
              quantity,
              unit_cost: toNumber(body.unit_cost, null),
              reason: String(body.reason).trim(),
              notes: body.notes || null,
              created_by: req.user.id,
            });

          await client.query(
            `
              INSERT INTO stock_adjustments (
                id, transaction_id, product_id, quantity, direction,
                reason, notes, document_path, created_by
              )
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            `,
            [
              uuid(),
              transaction.id,
              body.product_id,
              quantity,
              direction,
              String(body.reason).trim(),
              body.notes || null,
              body.document_path || null,
              req.user.id,
            ]
          );

          return transaction;
        });

      return res.status(201).json({ transaction: result });

    } catch (error) {
      console.error('[stock/adjustments]', error);

      const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 400;

      return res.status(status).json({
        error: error.message,
        available: error.available,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/imports
//
// Step one of the import: read the file, guess the columns, return a preview.
// Nothing is written to the ledger until the mapping is confirmed.
// ============================================================================

router.post(
  '/imports',
  requireAuth,
  requireRole('admin', 'reviewer'),
  upload.single('file'),
  async (req, res) => {
    try {

      if (!req.file) {
        return res.status(400).json({ error: 'No spreadsheet uploaded' });
      }

      const inspection =
        await importer.inspectSpreadsheet(req.file.path, req.file.mimetype);

      if (!inspection.headers.length) {
        return res.status(400).json({
          error: 'No column headers could be found in that spreadsheet',
        });
      }

      const importId = uuid();

      await db.run(
        `
          INSERT INTO stock_imports (
            id, filename, mime_type, file_path, status,
            sheet_name, detected_columns, column_mapping,
            total_rows, created_by
          )
          VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9)
        `,
        [
          importId,
          req.file.originalname,
          req.file.mimetype,
          path.relative(path.join(__dirname, '..'), req.file.path),
          inspection.sheetName,
          JSON.stringify(inspection.headers),
          JSON.stringify(inspection.mapping),
          inspection.totalRows,
          req.user.id,
        ]
      );

      return res.status(201).json({
        import_id: importId,
        sheet_name: inspection.sheetName,
        headers: inspection.headers,
        suggested_mapping: inspection.mapping,
        mapping_confidence: inspection.confidence,
        sample_rows: inspection.sample,
        total_rows: inspection.totalRows,
        target_fields: importer.TARGET_FIELDS,
      });

    } catch (error) {
      console.error('[stock/imports]', error);

      return res.status(400).json({
        error: `Unable to read that spreadsheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/imports/:id/commit
//
// Step two: the confirmed mapping is applied. Products are created or updated
// and each row becomes an OPENING_BALANCE movement in the ledger.
// ============================================================================

router.post(
  '/imports/:id/commit',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const record =
        await db.get('SELECT * FROM stock_imports WHERE id = $1', [req.params.id]);

      if (!record) {
        return res.status(404).json({ error: 'Import not found' });
      }

      if (record.status === 'committed') {
        return res.status(409).json({
          error: 'This import has already been committed',
        });
      }

      const mapping = req.body?.mapping || JSON.parse(record.column_mapping || '{}');

      // "Update what is there, add nothing new" — the safe mode for a sheet
      // whose purpose is to fill in a field on products that already exist.
      const updateOnly =
        req.body?.update_only === true || req.body?.update_only === 'true';

      // A store keeps its stock as separate lists — consumables, fittings,
      // electrical — one sheet each. The sheet itself is the group, so it can
      // be named for the whole import rather than repeated down a column.
      const importGroup =
        req.body?.stock_group
          ? String(req.body.stock_group).trim() || null
          : null;

      const mappedFields = Object.values(mapping).filter(Boolean);

      if (!mappedFields.includes('description') && !mappedFields.includes('sku')) {
        return res.status(400).json({
          error: 'Map at least a product description or an SKU column before importing',
        });
      }

      const absolutePath =
        path.isAbsolute(record.file_path)
          ? record.file_path
          : path.join(__dirname, '..', record.file_path);

      if (!fs.existsSync(absolutePath)) {
        return res.status(410).json({
          error: 'The uploaded spreadsheet is no longer available. Please upload it again.',
        });
      }

      const inspection =
        await importer.inspectSpreadsheet(absolutePath, record.mime_type);

      const locationId =
        req.body?.location_id ||
        record.location_id ||
        (await ledger.defaultLocationId(null));

      let imported = 0;
      let skipped = 0;
      let binsRecorded = 0;

      const errors = [];

      for (let index = 0; index < inspection.rows.length; index++) {
        const raw = inspection.rows[index];
        const parsed = importer.extractRow(raw, mapping);

        const rowId = uuid();
        const rowNumber = index + 1;

        // A column on the sheet wins over the name given for the whole import.
        const stockGroup = parsed.stock_group || importGroup;

        // A row with neither a name nor a code cannot become a product.
        if (!parsed.description && !parsed.sku) {
          skipped++;

          await db.run(
            `
              INSERT INTO stock_import_rows
                (id, import_id, row_number, raw_data, status, message)
              VALUES ($1,$2,$3,$4,'skipped',$5)
            `,
            [rowId, record.id, rowNumber, JSON.stringify(raw), 'No description or SKU']
          );

          continue;
        }

        try {

          await db.transaction(async (client) => {

            const supplierId =
              await findOrCreateSupplier(client, parsed.supplier_name);

            const description =
              parsed.description || parsed.sku;

            const normalized = matching.normalizeDescription(description);

            // Re-importing a sheet should update the product it already
            // created, not make a second one — and the column a store used as
            // its identifier last time is not always the one it uses this
            // time. Strongest evidence first: the SKU, then the supplier's own
            // code for that supplier, then the wording.
            let existing =
              await client.query(
                `
                  SELECT * FROM products
                  WHERE $1::text IS NOT NULL AND sku = $1
                  LIMIT 1
                `,
                [parsed.sku || null]
              );

            if (!existing.rows.length && parsed.supplier_product_code) {
              existing =
                await client.query(
                  `
                    SELECT * FROM products
                    WHERE supplier_product_code = $1
                      AND ($2::text IS NULL OR supplier_id = $2)
                    LIMIT 1
                  `,
                  [parsed.supplier_product_code, supplierId]
                );
            }

            if (!existing.rows.length) {
              existing =
                await client.query(
                  `
                    SELECT * FROM products
                    WHERE normalized_description = $1
                    LIMIT 1
                  `,
                  [normalized]
                );
            }

            // Applying bins to a master that is already live should not be
            // able to invent products: a row that matches nothing is reported
            // and skipped rather than created.
            if (!existing.rows.length && updateOnly) {
              throw Object.assign(
                new Error('No existing product matches this row'),
                { skipRow: true }
              );
            }

            let productId;

            if (existing.rows.length) {
              productId = existing.rows[0].id;

              await client.query(
                `
                  UPDATE products
                  SET description = COALESCE($1, description),
                      normalized_description = COALESCE($2, normalized_description),
                      category = COALESCE($3, category),
                      unit_of_measure = COALESCE($4, unit_of_measure),
                      unit_cost = COALESCE($5, unit_cost),
                      reorder_level = COALESCE($6, reorder_level),
                      supplier_id = COALESCE($7, supplier_id),
                      supplier_product_code = COALESCE($8, supplier_product_code),
                      barcode = COALESCE($9, barcode),
                      stock_group = COALESCE($10, stock_group),
                      updated_at = NOW()
                  WHERE id = $11
                `,
                [
                  description,
                  normalized,
                  parsed.category,
                  parsed.unit_of_measure,
                  parsed.unit_cost,
                  parsed.reorder_level,
                  supplierId,
                  parsed.supplier_product_code,
                  parsed.barcode,
                  stockGroup,
                  productId,
                ]
              );

            } else {

              productId = uuid();

              await client.query(
                `
                  INSERT INTO products (
                    id, sku, description, normalized_description, category,
                    unit_of_measure, unit_cost, reorder_level, supplier_id,
                    supplier_product_code, barcode, bin_location, stock_group,
                    created_by
                  )
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                `,
                [
                  productId,
                  parsed.sku,
                  description,
                  normalized,
                  parsed.category,
                  parsed.unit_of_measure || 'ea',
                  parsed.unit_cost ?? 0,
                  parsed.reorder_level ?? 0,
                  supplierId,
                  parsed.supplier_product_code,
                  parsed.barcode,
                  parsed.bin_location,
                  stockGroup,
                  req.user.id,
                ]
              );
            }

            // A product listed in several bins keeps all of them: each one is
            // a real place the part is stored, and each one gets written on a
            // sign-out sheet sooner or later.
            if (parsed.bin_location) {
              const added =
                await matching.rememberBin(
                  {
                    productId,
                    bin: parsed.bin_location,
                    source: 'import',
                    userId: req.user.id,
                  },
                  client
                );

              if (added) binsRecorded += 1;
            }

            let transactionId = null;

            // The quantity from the sheet enters as a ledger event so it can
            // be traced back to this import later.
            //
            // Update-only exists to fill in a field on products that already
            // exist — bins, costs, categories — so it never posts a balance,
            // whatever the mapping says a column is. That makes it safe to run
            // against a live master: the worst a wrong mapping can do is write
            // a wrong attribute, not invent stock.
            if (!updateOnly && parsed.quantity && parsed.quantity > 0) {
              const transaction =
                await ledger.postMovement(client, {
                  product_id: productId,
                  location_id: locationId,
                  transaction_type: 'OPENING_BALANCE',
                  quantity: parsed.quantity,
                  unit_cost: parsed.unit_cost ?? null,
                  supplier_id: supplierId,
                  source_document_type: 'STOCK_IMPORT',
                  source_document_id: record.id,
                  source_line_id: rowId,
                  reason: `Opening balance from ${record.filename || 'spreadsheet import'}`,
                  created_by: req.user.id,
                });

              transactionId = transaction.id;
            }

            await client.query(
              `
                INSERT INTO stock_import_rows (
                  id, import_id, row_number, raw_data, sku, description,
                  category, unit_of_measure, quantity, unit_cost,
                  supplier_name, supplier_product_code, barcode, reorder_level,
                  product_id, transaction_id, status
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'imported')
              `,
              [
                rowId,
                record.id,
                rowNumber,
                JSON.stringify(raw),
                parsed.sku,
                description,
                parsed.category,
                parsed.unit_of_measure,
                parsed.quantity,
                parsed.unit_cost,
                parsed.supplier_name,
                parsed.supplier_product_code,
                parsed.barcode,
                parsed.reorder_level,
                productId,
                transactionId,
              ]
            );
          });

          imported++;

        } catch (rowError) {

          skipped++;

          if (!rowError.skipRow) {
            errors.push(`Row ${rowNumber}: ${rowError.message}`);
          }

          await db.run(
            `
              INSERT INTO stock_import_rows
                (id, import_id, row_number, raw_data, status, message)
              VALUES ($1,$2,$3,$4,$5,$6)
            `,
            [
              uuid(),
              record.id,
              rowNumber,
              JSON.stringify(raw),
              rowError.skipRow ? 'skipped' : 'failed',
              rowError.message,
            ]
          );
        }
      }

      await db.run(
        `
          UPDATE stock_imports
          SET status = 'committed',
              column_mapping = $1,
              location_id = $2,
              imported_rows = $3,
              skipped_rows = $4,
              committed_at = NOW()
          WHERE id = $5
        `,
        [
          JSON.stringify(mapping),
          locationId,
          imported,
          skipped,
          record.id,
        ]
      );

      return res.json({
        import_id: record.id,
        imported,
        skipped,
        update_only: updateOnly,
        stock_group: importGroup,
        bins_recorded: binsRecorded,
        errors: errors.slice(0, 20),
      });

    } catch (error) {
      console.error('[stock/imports/commit]', error);

      return res.status(500).json({
        error: `Unable to import stock: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/imports
// ============================================================================

router.get(
  '/imports',
  requireAuth,
  async (req, res) => {
    try {

      const rows =
        await db.all(
          `
            SELECT i.*, u.name AS created_by_name
            FROM stock_imports i
            LEFT JOIN users u ON u.id = i.created_by
            ORDER BY i.created_at DESC
            LIMIT 50
          `
        );

      return res.json({ imports: rows });

    } catch (error) {
      console.error('[stock/imports/list]', error);

      return res.status(500).json({
        error: `Unable to load imports: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/locations
// ============================================================================

router.get(
  '/locations',
  requireAuth,
  async (req, res) => {
    try {

      const rows =
        await db.all(
          `
            SELECT
              l.*,
              COALESCE(SUM(b.quantity), 0) AS total_units
            FROM stock_locations l
            LEFT JOIN stock_balances b ON b.location_id = l.id
            GROUP BY l.id
            ORDER BY l.is_default DESC, l.name
          `
        );

      return res.json({ locations: rows });

    } catch (error) {
      console.error('[stock/locations]', error);

      return res.status(500).json({
        error: `Unable to load locations: ${error.message}`,
      });
    }
  }
);

router.post(
  '/locations',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {

      const { code, name } = req.body || {};

      if (!code || !name) {
        return res.status(400).json({
          error: 'A location code and name are required',
        });
      }

      const result =
        await db.run(
          `
            INSERT INTO stock_locations (id, code, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (code) DO NOTHING
            RETURNING *
          `,
          [uuid(), String(code).trim().toUpperCase(), String(name).trim()]
        );

      if (!result.rows.length) {
        return res.status(409).json({
          error: 'A location with that code already exists',
        });
      }

      return res.status(201).json({ location: result.rows[0] });

    } catch (error) {
      console.error('[stock/locations/create]', error);

      return res.status(500).json({
        error: `Unable to create location: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/review
//
// Lines that could not be matched confidently, with their candidates.
// ============================================================================

router.get(
  '/review',
  requireAuth,
  async (req, res) => {
    try {

      const status = req.query.status || 'pending';

      const rows =
        await db.all(
          `
            SELECT
              r.*,
              s.name AS supplier_name,
              i.invoice_number,
              sh.sheet_number
            FROM stock_review_queue r
            LEFT JOIN suppliers s ON s.id = r.supplier_id
            LEFT JOIN invoices i
              ON r.source_document_type = 'INVOICE'
             AND i.id = r.source_document_id
            LEFT JOIN stock_sheets sh
              ON r.source_document_type = 'STOCK_SHEET'
             AND sh.id = r.source_document_id
            WHERE ($1 = 'all' OR r.status = $1)
            ORDER BY r.created_at DESC
            LIMIT 200
          `,
          [status]
        );

      return res.json({
        items: rows.map((row) => {
          let candidates = [];

          try {
            candidates = JSON.parse(row.candidates || '[]');
          } catch (error) {
            candidates = [];
          }

          return { ...row, candidates };
        }),
      });

    } catch (error) {
      console.error('[stock/review]', error);

      return res.status(500).json({
        error: `Unable to load the review queue: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/review/:id/resolve
//
// A person picks the right product. The movement is posted, and the mapping is
// remembered so the same wording resolves itself next time.
// ============================================================================

router.post(
  '/review/:id/resolve',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const item =
        await db.get(
          'SELECT * FROM stock_review_queue WHERE id = $1',
          [req.params.id]
        );

      if (!item) {
        return res.status(404).json({ error: 'Review item not found' });
      }

      if (item.status !== 'pending') {
        return res.status(409).json({
          error: `This item was already ${item.status}`,
        });
      }

      // Dismissing means "this line is not stock" — no movement, no mapping.
      if (req.body?.dismiss) {
        await db.run(
          `
            UPDATE stock_review_queue
            SET status = 'dismissed',
                resolved_by = $1,
                resolved_at = NOW()
            WHERE id = $2
          `,
          [req.user.id, item.id]
        );

        // Keep the invoice line's own answer in step with the queue: dismissed
        // means a person said this is not stock.
        if (item.source_line_id && item.source_document_type === 'INVOICE') {
          await db.run(
            `
              UPDATE invoice_line_items
              SET stock_decision = $1,
                  stock_decision_reason = $2,
                  stock_decision_by = $3,
                  stock_decision_at = NOW()
              WHERE id = $4
            `,
            [
              invoiceStock.DECISIONS.DO_NOT_STOCK,
              'NON_INVENTORY',
              req.user.id,
              item.source_line_id,
            ]
          );
        }

        return res.json({ resolved: true, dismissed: true });
      }

      const productId = req.body?.product_id;

      if (!productId) {
        return res.status(400).json({
          error: 'Choose the product this line refers to',
        });
      }

      const product =
        await db.get('SELECT id FROM products WHERE id = $1', [productId]);

      if (!product) {
        return res.status(400).json({ error: 'That product does not exist' });
      }

      const transaction =
        await db.transaction(async (client) => {

          const written =
            await ledger.postMovement(client, {
              product_id: productId,
              location_id: item.location_id,
              // An invoice line receipts stock in; a stock sheet issues it out.
              transaction_type:
                item.source_document_type === 'STOCK_SHEET'
                  ? 'STOCK_ISSUE'
                  : 'PURCHASE_RECEIPT',
              quantity: Number(item.quantity || 0),
              unit_cost: item.unit_cost,
              supplier_id: item.supplier_id,
              source_document_type: item.source_document_type,
              source_document_id: item.source_document_id,
              source_line_id: item.source_line_id,
              reason: 'Resolved from the stock review queue',
              match_confidence: 1,
              created_by: req.user.id,
            });

          await client.query(
            `
              UPDATE stock_review_queue
              SET status = 'resolved',
                  resolved_product_id = $1,
                  resolved_transaction_id = $2,
                  resolved_by = $3,
                  resolved_at = NOW()
              WHERE id = $4
            `,
            [productId, written.id, req.user.id, item.id]
          );

          if (item.source_line_id && item.source_document_type === 'INVOICE') {
            await client.query(
              `
                UPDATE invoice_line_items
                SET product_id = $1,
                    match_confidence = 1,
                    match_method = 'manual_review',
                    stock_decision = 'POSTED',
                    stock_decision_by = $3,
                    stock_decision_at = NOW()
                WHERE id = $2
              `,
              [productId, item.source_line_id, req.user.id]
            );
          }

          return written;
        });

      // Learn from the decision so this wording resolves automatically later.
      await matching.rememberMatch({
        supplierId: item.supplier_id,
        sourceText: item.raw_description,
        sourceCode: item.raw_code,
        productId,
        method: 'manual_review',
        confidence: 1,
        userId: req.user.id,
      });

      return res.json({ resolved: true, transaction });

    } catch (error) {
      console.error('[stock/review/resolve]', error);

      const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 400;

      return res.status(status).json({
        error: error.message,
        available: error.available,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/match
//
// Exposes the matcher on its own, for the review UI's product picker.
// ============================================================================

router.post(
  '/match',
  requireAuth,
  async (req, res) => {
    try {

      const result =
        await matching.matchProduct({
          description: req.body?.description,
          code: req.body?.code,
          barcode: req.body?.barcode,
          bin: req.body?.bin,
          supplier_id: req.body?.supplier_id,
          limit: 8,
        });

      return res.json({
        ...result,
        threshold: matching.AUTO_MATCH_THRESHOLD,
      });

    } catch (error) {
      console.error('[stock/match]', error);

      return res.status(500).json({
        error: `Unable to match product: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/bins/available
//
// What the bin sheet that ships with the app holds, and how much of it would
// land on the product master as it stands. Changes nothing.
// ============================================================================

router.get(
  '/bins/available',
  requireAuth,
  async (req, res) => {
    try {

      const info = binSeed.summary();

      if (!info.row_count) {
        return res.json({ ...info, matched: 0, available: false });
      }

      const preview = await binSeed.preview();

      const withBin =
        await db.get(
          `
            SELECT COUNT(*)::int AS c
            FROM products
            WHERE is_active = TRUE
              AND COALESCE(NULLIF(TRIM(bin_location), ''), '') <> ''
          `
        );

      return res.json({
        ...info,
        available: true,
        matched: preview.matched,
        unmatched: preview.unmatched,
        pending_bins: preview.pending_bins,
        pending_groups: preview.pending_groups,
        pending: preview.pending_bins + preview.pending_groups,
        products_with_bin: Number(withBin?.c || 0),
      });

    } catch (error) {
      console.error('[stock/bins/available]', error);

      return res.status(500).json({
        error: `Unable to read the bundled bin sheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/bins/apply
//
// Fills in the bins and stock groups from that sheet. Creates no product,
// moves no stock, writes no ledger entry.
// ============================================================================

router.post(
  '/bins/apply',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const result = await binSeed.apply({ userId: req.user.id });

      if (!result.applied) {
        return res.status(404).json({
          error: 'No bin sheet ships with this version of InvoiceFlow.',
          ...result,
        });
      }

      return res.json(result);

    } catch (error) {
      console.error('[stock/bins/apply]', error);

      return res.status(500).json({
        error: `Unable to apply the bin sheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/reconcile
//
// Proves the cached balances still agree with the ledger, and repairs any that
// do not. Anything reported here is a defect worth investigating.
// ============================================================================

router.post(
  '/reconcile',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {

      const discrepancies = await ledger.reconcileBalances({ repair: true });

      return res.json({
        checked: true,
        discrepancies,
        clean: discrepancies.length === 0,
      });

    } catch (error) {
      console.error('[stock/reconcile]', error);

      return res.status(500).json({
        error: `Unable to reconcile stock: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// STOCK SIGN-OUT SHEETS
//
// A sign-out sheet is a document — a photo, a scan or a spreadsheet — that
// records stock taken out. It is read, matched and validated first, and only
// deducts stock once a person approves it. Nothing here writes movements
// directly; services/stockSheet posts through the same ledger as everything
// else, atomically and once.
// ============================================================================

const SHEET_DIR = path.join(__dirname, '..', 'data', 'stock-sheets');

if (!fs.existsSync(SHEET_DIR)) {
  fs.mkdirSync(SHEET_DIR, { recursive: true });
}

const SHEET_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf',
  '.xlsx', '.xls', '.csv', '.tsv',
];

const sheetUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, SHEET_DIR),
    filename: (req, file, cb) =>
      cb(null, `${uuid()}${path.extname(file.originalname) || '.jpg'}`),
  }),

  limits: { fileSize: 20 * 1024 * 1024 },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
      'application/csv',
      'application/octet-stream',
    ];

    const extension = path.extname(file.originalname).toLowerCase();

    const ok =
      allowedTypes.includes(file.mimetype) ||
      SHEET_EXTENSIONS.includes(extension);

    cb(
      ok
        ? null
        : new Error(
            'Unsupported file type — upload a photo, a PDF, or an Excel/CSV sheet'
          ),
      ok
    );
  },
});

const SHEET_HEADER_FIELDS = [
  'employee_name',
  'job_reference',
  'department',
  'vehicle',
  'issue_date',
  'notes',
];

/**
 * Loads a sheet with its rows, product details and parsed match candidates.
 */
async function loadSheet(sheetId) {
  const sheet =
    await db.get(
      `
        SELECT
          s.*,
          l.code AS location_code,
          l.name AS location_name,
          c.name AS created_by_name,
          p.name AS posted_by_name
        FROM stock_sheets s
        LEFT JOIN stock_locations l ON l.id = s.location_id
        LEFT JOIN users c ON c.id = s.created_by
        LEFT JOIN users p ON p.id = s.posted_by
        WHERE s.id = $1
      `,
      [sheetId]
    );

  if (!sheet) return null;

  const rows =
    await db.all(
      `
        SELECT
          r.*,
          p.sku,
          p.description AS product_description,
          p.unit_of_measure AS product_unit,
          p.bin_location AS product_bin,
          p.is_active AS product_active,
          u.name AS corrected_by_name
        FROM stock_sheet_rows r
        LEFT JOIN products p ON p.id = r.product_id
        LEFT JOIN users u ON u.id = r.corrected_by
        WHERE r.sheet_id = $1
        ORDER BY r.row_number
      `,
      [sheetId]
    );

  return {
    ...sheet,
    header_confidence: safeParse(sheet.header_confidence, {}),
    rows: rows.map((row) => ({
      ...row,
      quantity: row.quantity == null ? null : Number(row.quantity),
      stock_before: row.stock_before == null ? null : Number(row.stock_before),
      stock_after: row.stock_after == null ? null : Number(row.stock_after),
      candidates: safeParse(row.candidates, []),
    })),
  };
}

function safeParse(value, fallback) {
  if (value == null || value === '') return fallback;

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

// ============================================================================
// POST /api/stock/sheets
//
// Upload. The document is stored and read in the background so the browser can
// show progress; the sheet's status is the single source of truth for where it
// has got to.
// ============================================================================

router.post(
  '/sheets',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  sheetUpload.single('file'),
  async (req, res) => {
    try {

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const hash = sheets.fileHash(req.file.path);

      // Duplicate protection: the same document uploaded twice is refused
      // unless the person says it really is a second sign-out.
      const duplicate =
        await db.get(
          `
            SELECT id, sheet_number, status, created_at
            FROM stock_sheets
            WHERE file_hash = $1
              AND status <> 'CANCELLED'
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [hash]
        );

      const allowDuplicate =
        req.body?.allow_duplicate === 'true' || req.body?.allow_duplicate === true;

      if (duplicate && !allowDuplicate) {
        fs.unlink(req.file.path, () => {});

        return res.status(409).json({
          error: `This document was already uploaded as ${duplicate.sheet_number}`,
          duplicate_of: duplicate,
        });
      }

      const sheetId = uuid();
      const sheetNumber = await sheets.nextSheetNumber();

      const relativePath =
        path.relative(path.join(__dirname, '..'), req.file.path);

      await db.run(
        `
          INSERT INTO stock_sheets
            (id, sheet_number, filename, mime_type, file_path, file_hash,
             status, location_id, employee_name, job_reference, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, 'UPLOADED', $7, $8, $9, $10, $11)
        `,
        [
          sheetId,
          sheetNumber,
          req.file.originalname,
          req.file.mimetype,
          relativePath,
          hash,
          req.body?.location_id || null,
          req.body?.employee_name || null,
          req.body?.job_reference || null,
          req.body?.notes || null,
          req.user.id,
        ]
      );

      // Reading takes seconds; the upload response should not wait for it.
      // A failure is recorded on the sheet itself, never thrown away.
      sheets
        .processSheet(sheetId)
        .catch((error) => {
          console.error('[stock/sheets/process]', sheetNumber, error.message);
        });

      return res.status(201).json({
        sheet: {
          id: sheetId,
          sheet_number: sheetNumber,
          status: 'PROCESSING',
          filename: req.file.originalname,
        },
      });

    } catch (error) {
      console.error('[stock/sheets/upload]', error);

      if (req.file) fs.unlink(req.file.path, () => {});

      return res.status(500).json({
        error: `Unable to upload the sign-out sheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/sheets/metrics
//
// Registered before /sheets/:id so "metrics" is not read as an id.
// ============================================================================

router.get(
  '/sheets/metrics',
  requireAuth,
  async (req, res) => {
    try {

      const totals =
        await db.get(
          `
            SELECT
              COUNT(*)::int AS total,
              COUNT(*) FILTER (
                WHERE status IN ('UPLOADED', 'PROCESSING')
              )::int AS processing,
              COUNT(*) FILTER (WHERE status = 'REVIEW_REQUIRED')::int AS review,
              COUNT(*) FILTER (WHERE status = 'READY')::int AS ready,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
              COUNT(*) FILTER (
                WHERE status = 'POSTED'
                  AND posted_at >= NOW() - INTERVAL '7 days'
              )::int AS posted_this_week,
              COUNT(*) FILTER (
                WHERE created_at >= date_trunc('day', NOW())
              )::int AS uploaded_today,
              COUNT(*) FILTER (
                WHERE status = 'POSTED'
                  AND posted_at >= date_trunc('day', NOW())
              )::int AS posted_today
            FROM stock_sheets
          `
        );

      const today =
        await db.get(
          `
            SELECT
              COALESCE(SUM(quantity), 0) AS units_issued,
              COUNT(*)::int AS movements
            FROM stock_transactions
            WHERE source_document_type = 'STOCK_SHEET'
              AND created_at >= date_trunc('day', NOW())
          `
        );

      const recent =
        await db.all(
          `
            SELECT
              s.id, s.sheet_number, s.filename, s.status, s.employee_name,
              s.job_reference, s.row_count, s.matched_count, s.review_count,
              s.total_quantity, s.created_at, s.posted_at,
              u.name AS created_by_name
            FROM stock_sheets s
            LEFT JOIN users u ON u.id = s.created_by
            ORDER BY s.created_at DESC
            LIMIT 8
          `
        );

      const issued =
        await db.get(
          `
            SELECT
              COALESCE(SUM(quantity), 0) AS units_issued,
              COUNT(*)::int AS movements
            FROM stock_transactions
            WHERE source_document_type = 'STOCK_SHEET'
              AND created_at >= NOW() - INTERVAL '30 days'
          `
        );

      const employees =
        await db.all(
          `
            SELECT
              COALESCE(NULLIF(TRIM(employee_name), ''), 'Unnamed') AS employee_name,
              COUNT(*)::int AS movements,
              COALESCE(SUM(quantity), 0) AS units
            FROM stock_transactions
            WHERE source_document_type = 'STOCK_SHEET'
              AND created_at >= NOW() - INTERVAL '90 days'
            GROUP BY 1
            ORDER BY units DESC
            LIMIT 5
          `
        );

      const jobs =
        await db.all(
          `
            SELECT
              job_reference,
              COUNT(*)::int AS movements,
              COALESCE(SUM(quantity), 0) AS units
            FROM stock_transactions
            WHERE source_document_type = 'STOCK_SHEET'
              AND job_reference IS NOT NULL
              AND TRIM(job_reference) <> ''
              AND created_at >= NOW() - INTERVAL '90 days'
            GROUP BY job_reference
            ORDER BY units DESC
            LIMIT 5
          `
        );

      const products =
        await db.all(
          `
            SELECT
              p.id,
              p.sku,
              p.description,
              COALESCE(SUM(t.quantity), 0) AS units
            FROM stock_transactions t
            JOIN products p ON p.id = t.product_id
            WHERE t.source_document_type = 'STOCK_SHEET'
              AND t.created_at >= NOW() - INTERVAL '90 days'
            GROUP BY p.id, p.sku, p.description
            ORDER BY units DESC
            LIMIT 5
          `
        );

      return res.json({
        totals: totals || {},
        units_issued: Number(issued?.units_issued || 0),
        movements: Number(issued?.movements || 0),
        units_issued_today: Number(today?.units_issued || 0),
        movements_today: Number(today?.movements || 0),
        recent,
        top_employees: employees.map((row) => ({
          ...row,
          units: Number(row.units),
        })),
        top_jobs: jobs.map((row) => ({ ...row, units: Number(row.units) })),
        top_products: products.map((row) => ({
          ...row,
          units: Number(row.units),
        })),
        extraction: ai.providerStatus(),
      });

    } catch (error) {
      console.error('[stock/sheets/metrics]', error);

      return res.status(500).json({
        error: `Unable to load sign-out metrics: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/sheets
// ============================================================================

router.get(
  '/sheets',
  requireAuth,
  async (req, res) => {
    try {

      const limit = Math.min(Math.max(toNumber(req.query.limit, 50), 1), 200);
      const page = Math.max(toNumber(req.query.page, 1), 1);
      const offset = (page - 1) * limit;

      const params = [];
      let where = ' WHERE 1 = 1';

      if (req.query.status && req.query.status !== 'all') {
        params.push(String(req.query.status).toUpperCase());
        where += ` AND s.status = $${params.length}`;
      }

      if (req.query.employee) {
        params.push(`%${req.query.employee}%`);
        where += ` AND s.employee_name ILIKE $${params.length}`;
      }

      if (req.query.q) {
        params.push(`%${req.query.q}%`);
        const p = `$${params.length}`;

        where += `
          AND (
            s.sheet_number ILIKE ${p}
            OR s.employee_name ILIKE ${p}
            OR s.job_reference ILIKE ${p}
            OR s.filename ILIKE ${p}
          )
        `;
      }

      const total =
        await db.get(
          `SELECT COUNT(*)::int AS c FROM stock_sheets s ${where}`,
          params
        );

      params.push(limit, offset);

      const rows =
        await db.all(
          `
            SELECT
              s.*,
              u.name AS created_by_name
            FROM stock_sheets s
            LEFT JOIN users u ON u.id = s.created_by
            ${where}
            ORDER BY s.created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
          `,
          params
        );

      return res.json({
        sheets: rows,
        total: Number(total?.c || 0),
        page,
        limit,
        pages: Math.max(1, Math.ceil(Number(total?.c || 0) / limit)),
      });

    } catch (error) {
      console.error('[stock/sheets/list]', error);

      return res.status(500).json({
        error: `Unable to load sign-out sheets: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/sheets/:id
// ============================================================================

router.get(
  '/sheets/:id',
  requireAuth,
  async (req, res) => {
    try {

      // Re-check against live stock before showing it. Stock moves between
      // extraction and review — another sheet consumes it, a count corrects
      // it — and a screen that says a sheet is ready when the ledger will
      // refuse it is worse than no screen at all.
      await sheets.revalidateSheet(req.params.id);

      const sheet = await loadSheet(req.params.id);

      if (!sheet) {
        return res.status(404).json({ error: 'Stock sheet not found' });
      }

      return res.json({
        sheet,
        thresholds: {
          accept: sheets.ACCEPT_THRESHOLD,
          review: sheets.MANDATORY_REVIEW_THRESHOLD,
        },
      });

    } catch (error) {
      console.error('[stock/sheets/detail]', error);

      return res.status(500).json({
        error: `Unable to load sign-out sheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/stock/sheets/:id/document
//
// The source document itself, so a movement can always be traced back to the
// piece of paper it came from.
// ============================================================================

router.get(
  '/sheets/:id/document',
  requireAuth,
  async (req, res) => {
    try {

      const sheet =
        await db.get(
          'SELECT file_path, mime_type FROM stock_sheets WHERE id = $1',
          [req.params.id]
        );

      if (!sheet || !sheet.file_path) {
        return res.status(404).json({ error: 'Stock sheet document not found' });
      }

      const absolutePath =
        path.isAbsolute(sheet.file_path)
          ? sheet.file_path
          : path.join(__dirname, '..', sheet.file_path);

      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({
          error: 'The sign-out sheet file could not be found on the server',
        });
      }

      return res.sendFile(absolutePath);

    } catch (error) {
      console.error('[stock/sheets/document]', error);

      return res.status(500).json({
        error: `Unable to load the sign-out sheet document: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// PATCH /api/stock/sheets/:id
//
// Corrects what the extraction read from the header — who signed for it, which
// job it was for, which store it came out of.
// ============================================================================

router.patch(
  '/sheets/:id',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const sheet =
        await db.get('SELECT * FROM stock_sheets WHERE id = $1', [req.params.id]);

      if (!sheet) {
        return res.status(404).json({ error: 'Stock sheet not found' });
      }

      if (sheet.status === 'POSTED') {
        return res.status(409).json({
          error: 'This sheet has already been posted to stock and cannot be edited',
        });
      }

      const updates = [];
      const params = [];

      SHEET_HEADER_FIELDS.forEach((field) => {
        if (!(field in (req.body || {}))) return;

        const value = req.body[field];

        params.push(value === '' ? null : value);
        updates.push(`${field} = $${params.length}`);
      });

      let locationChanged = false;

      if ('location_id' in (req.body || {})) {
        const locationId = req.body.location_id || null;

        if (locationId) {
          const location =
            await db.get(
              'SELECT id FROM stock_locations WHERE id = $1',
              [locationId]
            );

          if (!location) {
            return res.status(400).json({ error: 'That location does not exist' });
          }
        }

        locationChanged = locationId !== sheet.location_id;

        params.push(locationId);
        updates.push(`location_id = $${params.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      params.push(req.params.id);

      await db.run(
        `
          UPDATE stock_sheets
          SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${params.length}
        `,
        params
      );

      // Moving the sheet to another store changes what is available, so the
      // whole sheet is re-checked rather than left showing stale figures.
      if (locationChanged) {
        await sheets.revalidateSheet(req.params.id);
      }

      return res.json({ sheet: await loadSheet(req.params.id) });

    } catch (error) {
      console.error('[stock/sheets/update]', error);

      return res.status(500).json({
        error: `Unable to update the sign-out sheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// PATCH /api/stock/sheets/:id/rows/:rowId
//
// A person corrects one line: the product it means, the quantity that was
// written, or whether it belongs on this sheet at all. Picking a product is an
// explicit confirmation, so the wording is remembered for next time.
// ============================================================================

router.patch(
  '/sheets/:id/rows/:rowId',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const sheet =
        await db.get('SELECT * FROM stock_sheets WHERE id = $1', [req.params.id]);

      if (!sheet) {
        return res.status(404).json({ error: 'Stock sheet not found' });
      }

      if (sheet.status === 'POSTED') {
        return res.status(409).json({
          error: 'This sheet has already been posted to stock and cannot be edited',
        });
      }

      const row =
        await db.get(
          'SELECT * FROM stock_sheet_rows WHERE id = $1 AND sheet_id = $2',
          [req.params.rowId, req.params.id]
        );

      if (!row) {
        return res.status(404).json({ error: 'Sheet line not found' });
      }

      const body = req.body || {};

      const updates = [];
      const params = [];

      let confirmedProductId = null;

      if ('product_id' in body) {
        const productId = body.product_id || null;

        if (productId) {
          const product =
            await db.get(
              'SELECT id, is_active FROM products WHERE id = $1',
              [productId]
            );

          if (!product) {
            return res.status(400).json({ error: 'That product does not exist' });
          }

          if (product.is_active === false) {
            return res.status(400).json({
              error: 'That product is inactive — reactivate it first',
            });
          }

          confirmedProductId = productId;
        }

        params.push(productId);
        updates.push(`product_id = $${params.length}`);

        // A person chose it, so the line is no longer a guess.
        params.push(productId ? 1 : null);
        updates.push(`match_confidence = $${params.length}`);

        params.push(productId ? 'manual_review' : null);
        updates.push(`match_method = $${params.length}`);
      }

      if ('quantity' in body) {
        const quantity = toNumber(body.quantity, null);

        if (quantity === null || !(quantity > 0)) {
          return res.status(400).json({
            error: 'Enter a quantity greater than zero',
          });
        }

        params.push(quantity);
        updates.push(`quantity = $${params.length}`);

        params.push(1);
        updates.push(`quantity_confidence = $${params.length}`);
      }

      if ('excluded' in body) {
        const excluded =
          body.excluded === true || body.excluded === 'true';

        params.push(excluded ? 'EXCLUDED' : 'PENDING');
        updates.push(`status = $${params.length}`);

        params.push(
          excluded ? 'Excluded from this sheet by a reviewer' : null
        );
        updates.push(`issue = $${params.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      params.push(req.user.id);
      updates.push(`corrected_by = $${params.length}`);
      updates.push('corrected_at = NOW()');

      params.push(row.id);

      await db.run(
        `UPDATE stock_sheet_rows SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );

      // Re-check every line against live stock so the totals on screen and the
      // sheet's own status stay true after the correction.
      await sheets.revalidateSheet(req.params.id);

      // Learning happens only on an explicit correction, never on a guess the
      // matcher made by itself.
      if (confirmedProductId) {
        await matching.rememberMatch({
          supplierId: null,
          sourceText: row.raw_description,
          sourceCode: row.raw_product_code,
          productId: confirmedProductId,
          method: 'manual_review',
          confidence: 1,
          userId: req.user.id,
        });

        // A bin the sheet wrote that the product master does not know is a gap
        // in the master, not a mapping to remember: the correction records it
        // against the product, so the next sheet resolves that bin on its own.
        //
        // Only a value the sheet actually presented as a bin. A code column
        // may hold a supplier's part number, and recording that as a bin would
        // be worse than recording nothing.
        if (row.raw_bin) {
          await matching.rememberBin({
            productId: confirmedProductId,
            bin: row.raw_bin,
            source: 'stock_sheet',
            userId: req.user.id,
          });
        }
      }

      return res.json({ sheet: await loadSheet(req.params.id) });

    } catch (error) {
      console.error('[stock/sheets/rows/update]', error);

      return res.status(500).json({
        error: `Unable to update the sheet line: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/sheets/:id/retry
//
// Reads the document again — for a sheet that failed, or one whose extraction
// should be redone after the product master changed.
// ============================================================================

router.post(
  '/sheets/:id/retry',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const sheet =
        await db.get(
          'SELECT id, status FROM stock_sheets WHERE id = $1',
          [req.params.id]
        );

      if (!sheet) {
        return res.status(404).json({ error: 'Stock sheet not found' });
      }

      if (sheet.status === 'POSTED') {
        return res.status(409).json({
          error: 'This sheet has already been posted to stock',
        });
      }

      if (sheet.status === 'CANCELLED') {
        return res.status(409).json({ error: 'This sheet was cancelled' });
      }

      await db.run(
        `
          UPDATE stock_sheets
          SET status = 'PROCESSING', error_message = NULL, updated_at = NOW()
          WHERE id = $1
        `,
        [req.params.id]
      );

      sheets
        .processSheet(req.params.id)
        .catch((error) => {
          console.error('[stock/sheets/retry]', req.params.id, error.message);
        });

      return res.json({ retrying: true });

    } catch (error) {
      console.error('[stock/sheets/retry]', error);

      return res.status(500).json({
        error: `Unable to re-read the sign-out sheet: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/sheets/:id/approve
//
// The only route that deducts stock from a sign-out sheet. All-or-nothing: one
// unresolved line blocks the whole sheet, and approving twice deducts once.
// ============================================================================

router.post(
  '/sheets/:id/approve',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const result = await sheets.postSheet(req.params.id, req.user.id);

      if (result.posted) {
        return res.json({
          posted: true,
          transaction_count: result.transaction_count,
          sheet: await loadSheet(req.params.id),
        });
      }

      const messages = {
        not_found: 'Stock sheet not found',
        already_posted: 'This sheet has already been posted to stock',
        cancelled: 'This sheet was cancelled and cannot be posted',
        no_rows: 'This sheet has no lines to post',
        no_movements: 'This sheet has no lines to post',
        unresolved_rows:
          'Every line must be matched before stock can be deducted',
      };

      const status = result.reason === 'not_found' ? 404 : 409;

      return res.status(status).json({
        posted: false,
        reason: result.reason,
        error: messages[result.reason] || 'This sheet could not be posted',
        blocking: result.blocking || [],
        sheet:
          result.reason === 'not_found'
            ? null
            : await loadSheet(req.params.id),
      });

    } catch (error) {
      console.error('[stock/sheets/approve]', error);

      // A posting failure must leave stock exactly as it was; postDocument
      // rolls the whole document back, so the sheet stays un-posted.
      const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 400;

      // Two bare numbers are no use on a sheet of thirty lines. Say what ran
      // out and which line asked for it.
      if (error.code === 'INSUFFICIENT_STOCK' && error.product_id) {

        const product =
          await db.get(
            'SELECT description, sku, bin_location FROM products WHERE id = $1',
            [error.product_id]
          );

        const row =
          error.source_line_id
            ? await db.get(
                'SELECT row_number FROM stock_sheet_rows WHERE id = $1',
                [error.source_line_id]
              )
            : null;

        const name =
          product
            ? product.description ||
              product.sku ||
              product.bin_location ||
              'that product'
            : 'that product';

        return res.status(status).json({
          posted: false,
          reason: 'insufficient_stock',
          error:
            `Not enough ${name}${row ? ` on line ${row.row_number}` : ''}: ` +
            `${error.available} on hand, ${error.requested} requested.`,
          available: error.available,
          requested: error.requested,
          product_id: error.product_id,
          row_number: row ? row.row_number : null,
          sheet: await loadSheet(req.params.id),
        });
      }

      return res.status(status).json({
        posted: false,
        error: error.message,
        available: error.available,
      });
    }
  }
);

// ============================================================================
// POST /api/stock/sheets/:id/cancel
// ============================================================================

router.post(
  '/sheets/:id/cancel',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const sheet =
        await db.get(
          'SELECT id, status FROM stock_sheets WHERE id = $1',
          [req.params.id]
        );

      if (!sheet) {
        return res.status(404).json({ error: 'Stock sheet not found' });
      }

      if (sheet.status === 'POSTED') {
        return res.status(409).json({
          error:
            'This sheet has already been posted — reverse it with a stock adjustment instead',
        });
      }

      await db.run(
        `
          UPDATE stock_sheets
          SET status = 'CANCELLED',
              error_message = $1,
              updated_at = NOW()
          WHERE id = $2
        `,
        [req.body?.reason || null, req.params.id]
      );

      return res.json({ cancelled: true, sheet: await loadSheet(req.params.id) });

    } catch (error) {
      console.error('[stock/sheets/cancel]', error);

      return res.status(500).json({
        error: `Unable to cancel the sign-out sheet: ${error.message}`,
      });
    }
  }
);

module.exports = router;
