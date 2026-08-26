const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extractInvoice } = require('../services/aiExtraction');
const {
  validateInvoice,
  overallStatus,
  lowConfidenceFields
} = require('../services/validation');

const router = express.Router();

// ---------------------------------------------------------------------------
// UPLOAD CONFIGURATION
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.join(
  __dirname,
  '..',
  'data',
  'uploads'
);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, {
    recursive: true
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },

  filename: (req, file, cb) => {
    cb(
      null,
      `${uuid()}${path.extname(file.originalname) || '.jpg'}`
    );
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 15 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    ];

    const allowed =
      allowedTypes.includes(file.mimetype);

    cb(
      allowed
        ? null
        : new Error(
            'Unsupported file type — please upload a JPG, PNG, WEBP or PDF'
          ),
      allowed
    );
  }
});

// ---------------------------------------------------------------------------
// PROCESSING LOG
// ---------------------------------------------------------------------------

function log(
  invoiceId,
  stage,
  actorId,
  detail
) {
  db.prepare(`
    INSERT INTO invoice_processing_logs
      (
        id,
        invoice_id,
        stage,
        actor_id,
        detail
      )
    VALUES
      (?, ?, ?, ?, ?)
  `).run(
    uuid(),
    invoiceId,
    stage,
    actorId || null,
    detail
      ? JSON.stringify(detail)
      : null
  );
}

// ---------------------------------------------------------------------------
// SUPPLIER
// ---------------------------------------------------------------------------

function findOrCreateSupplier(
  name,
  vat,
  address,
  contact
) {
  if (!name) {
    return null;
  }

  const key =
    `${name.trim().toLowerCase()}|${(vat || '')
      .trim()
      .toLowerCase()}`;

  const existing =
    db.prepare(`
      SELECT *
      FROM suppliers
      WHERE normalized_key = ?
    `).get(key);

  if (existing) {
    return existing.id;
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO suppliers
      (
        id,
        name,
        vat_number,
        address,
        contact,
        normalized_key
      )
    VALUES
      (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    vat,
    address,
    contact,
    key
  );

  return id;
}

// ===========================================================================
// POST /api/invoices/capture
//
// Upload invoice
//      ↓
// Validate authenticated user
//      ↓
// Save invoice
//      ↓
// Gemini / Claude / Mock
//      ↓
// Validate extraction
//      ↓
// Save results
// ===========================================================================

router.post(
  '/capture',
  requireAuth,
  upload.single('file'),
  async (req, res) => {

    // -----------------------------------------------------------------------
    // FILE CHECK
    // -----------------------------------------------------------------------

    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    // -----------------------------------------------------------------------
    // USER CHECK
    //
    // This prevents the previous SQLite FOREIGN KEY crash.
    // The JWT can contain a user ID that doesn't exist in this database.
    // -----------------------------------------------------------------------

    const user =
      db.prepare(`
        SELECT id, name, role
        FROM users
        WHERE id = ?
      `).get(req.user.id);

    if (!user) {

      console.error(
        '[capture] Authenticated user does not exist in backend database:',
        req.user.id
      );

      return res.status(401).json({
        error:
          'Your login session is no longer valid. Please log out and log in again.'
      });
    }

    console.log(
      `[capture] Authenticated user: ${user.name} (${user.id})`
    );

    // -----------------------------------------------------------------------
    // CREATE INVOICE
    // -----------------------------------------------------------------------

    const invoiceId = uuid();
    const filePath = req.file.path;

    try {

      db.prepare(`
        INSERT INTO invoices
          (
            id,
            status,
            created_by
          )
        VALUES
          (?, ?, ?)
      `).run(
        invoiceId,
        'processing',
        user.id
      );

      db.prepare(`
        INSERT INTO invoice_documents
          (
            id,
            invoice_id,
            file_path,
            original_filename,
            mime_type
          )
        VALUES
          (?, ?, ?, ?, ?)
      `).run(
        uuid(),
        invoiceId,
        path.relative(
          path.join(__dirname, '..'),
          filePath
        ),
        req.file.originalname,
        req.file.mimetype
      );

    } catch (error) {

      console.error(
        '[capture] Failed to create invoice record:',
        error
      );

      return res.status(500).json({
        error:
          `Failed to create invoice record: ${error.message}`
      });
    }

    // -----------------------------------------------------------------------
    // PROCESS INVOICE
    // -----------------------------------------------------------------------

    try {

      log(
        invoiceId,
        'uploaded',
        user.id,
        {
          filename:
            req.file.originalname,

          mime_type:
            req.file.mimetype,

          file_size:
            req.file.size
        }
      );

      console.log(
        `[capture] Starting AI extraction for invoice ${invoiceId}`
      );

      // ---------------------------------------------------------------------
      // AI EXTRACTION
      // ---------------------------------------------------------------------

      const extraction =
        await extractInvoice(
          filePath,
          req.file.mimetype
        );

      console.log(
        `[capture] AI extraction completed using provider: ${extraction.provider}`
      );

      if (extraction.error) {
        console.warn(
          `[capture] AI provider returned with warning: ${extraction.error}`
        );
      }

      log(
        invoiceId,
        'ai_extracted',
        null,
        {
          provider:
            extraction.provider,

          error:
            extraction.error || null
        }
      );

      // ---------------------------------------------------------------------
      // EXISTING INVOICES FOR DUPLICATE CHECK
      // ---------------------------------------------------------------------

      const existing =
        db.prepare(`
          SELECT
            id,
            invoice_number,
            supplier_name,
            total_amount
          FROM invoices
          WHERE id != ?
        `).all(invoiceId);

      // ---------------------------------------------------------------------
      // VALIDATION
      // ---------------------------------------------------------------------

      const validationResults =
        validateInvoice(
          extraction.fields,
          existing
        );

      const status =
        overallStatus(
          validationResults,
          extraction.confidence
        );

      console.log(
        `[capture] Invoice validation completed. Status: ${status}`
      );

      log(
        invoiceId,
        'validated',
        null,
        {
          status
        }
      );

      // ---------------------------------------------------------------------
      // SUPPLIER
      // ---------------------------------------------------------------------

      const supplierId =
        findOrCreateSupplier(
          extraction.fields.supplier_name,
          extraction.fields.supplier_vat_number,
          extraction.fields.supplier_address,
          extraction.fields.supplier_contact
        );

      // ---------------------------------------------------------------------
      // SAVE EXTRACTED INVOICE
      // ---------------------------------------------------------------------

      const f =
        extraction.fields;

      db.prepare(`
        UPDATE invoices SET

          invoice_number=?,
          supplier_id=?,
          supplier_name=?,
          supplier_vat_number=?,
          supplier_address=?,
          supplier_contact=?,

          invoice_date=?,
          due_date=?,
          purchase_order_number=?,

          subtotal=?,
          vat_amount=?,
          total_amount=?,

          currency=?,
          payment_terms=?,

          status=?,
          overall_confidence=?,
          field_confidence=?,
          ai_raw_response=?,

          updated_at=datetime('now')

        WHERE id=?
      `).run(

        f.invoice_number,

        supplierId,

        f.supplier_name,

        f.supplier_vat_number,

        f.supplier_address,

        f.supplier_contact,

        f.invoice_date,

        f.due_date,

        f.purchase_order_number,

        f.subtotal,

        f.vat_amount,

        f.total_amount,

        f.currency,

        f.payment_terms,

        status,

        avgConfidence(
          extraction.confidence
        ),

        JSON.stringify(
          extraction.confidence
        ),

        JSON.stringify({
          provider:
            extraction.provider,

          error:
            extraction.error || null
        }),

        invoiceId
      );

      // ---------------------------------------------------------------------
      // LINE ITEMS
      // ---------------------------------------------------------------------

      for (
        const li of extraction.lineItems
      ) {

        db.prepare(`
          INSERT INTO invoice_line_items
            (
              id,
              invoice_id,
              description,
              quantity,
              unit_price,
              vat,
              total
            )
          VALUES
            (?, ?, ?, ?, ?, ?, ?)
        `).run(

          uuid(),

          invoiceId,

          li.description,

          li.quantity,

          li.unit_price,

          li.vat,

          li.total
        );
      }

      // ---------------------------------------------------------------------
      // VALIDATION RESULTS
      // ---------------------------------------------------------------------

      for (
        const vr of validationResults
      ) {

        db.prepare(`
          INSERT INTO invoice_validation_results
            (
              id,
              invoice_id,
              rule_code,
              passed,
              severity,
              message
            )
          VALUES
            (?, ?, ?, ?, ?, ?)
        `).run(

          uuid(),

          invoiceId,

          vr.rule_code,

          vr.passed
            ? 1
            : 0,

          vr.severity,

          vr.message
        );
      }

      // ---------------------------------------------------------------------
      // SUCCESS
      // ---------------------------------------------------------------------

      console.log(
        `[capture] Invoice ${invoiceId} successfully processed`
      );

      return res.json({
        invoice:
          getInvoiceFull(
            invoiceId
          )
      });

    } catch (err) {

      // ---------------------------------------------------------------------
      // PROCESSING ERROR
      // ---------------------------------------------------------------------

      console.error(
        '[capture] Invoice processing failed:',
        err
      );

      try {

        db.prepare(`
          UPDATE invoices
          SET
            status='exception',
            updated_at=datetime('now')
          WHERE id=?
        `).run(invoiceId);

        db.prepare(`
          INSERT INTO invoice_validation_results
            (
              id,
              invoice_id,
              rule_code,
              passed,
              severity,
              message
            )
          VALUES
            (?, ?, ?, ?, ?, ?)
        `).run(

          uuid(),

          invoiceId,

          'PROCESSING_ERROR',

          0,

          'error',

          `We couldn't confidently read this invoice: ${err.message}`
        );

        log(
          invoiceId,
          'error',
          null,
          {
            message:
              err.message
          }
        );

      } catch (fallbackError) {

        console.error(
          '[capture/fallback]',
          fallbackError
        );
      }

      // Return 200 so the frontend can display the exception/review state
      // rather than treating the whole request as a server crash.

      return res.status(200).json({

        invoice:
          getInvoiceFull(
            invoiceId
          ),

        warning:
          "We couldn't confidently read this invoice. Please review and enter the details manually, or retake the photo."
      });
    }
  }
);

// ===========================================================================
// CONFIDENCE
// ===========================================================================

function avgConfidence(
  confidence
) {

  const values =
    Object.values(
      confidence || {}
    ).filter(
      value =>
        typeof value === 'number'
    );

  if (!values.length) {
    return null;
  }

  return Math.round(
    (
      values.reduce(
        (a, b) => a + b,
        0
      ) /
      values.length
    ) * 100
  ) / 100;
}

// ===========================================================================
// GET FULL INVOICE
// ===========================================================================

function getInvoiceFull(
  id
) {

  const invoice =
    db.prepare(`
      SELECT *
      FROM invoices
      WHERE id = ?
    `).get(id);

  if (!invoice) {
    return null;
  }

  const lineItems =
    db.prepare(`
      SELECT *
      FROM invoice_line_items
      WHERE invoice_id = ?
    `).all(id);

  const validation =
    db.prepare(`
      SELECT *
      FROM invoice_validation_results
      WHERE invoice_id = ?
      ORDER BY created_at
    `).all(id);

  const documents =
    db.prepare(`
      SELECT *
      FROM invoice_documents
      WHERE invoice_id = ?
    `).all(id);

  const logs =
    db.prepare(`
      SELECT
        l.*,
        u.name AS actor_name

      FROM invoice_processing_logs l

      LEFT JOIN users u
        ON u.id = l.actor_id

      WHERE l.invoice_id = ?

      ORDER BY l.created_at
    `).all(id);

  const processedBy =
    invoice.processed_by
      ? db.prepare(`
          SELECT name
          FROM users
          WHERE id = ?
        `).get(invoice.processed_by)
      : null;

  const createdBy =
    invoice.created_by
      ? db.prepare(`
          SELECT name
          FROM users
          WHERE id = ?
        `).get(invoice.created_by)
      : null;

  return {

    ...invoice,

    field_confidence:
      invoice.field_confidence
        ? JSON.parse(
            invoice.field_confidence
          )
        : {},

    low_confidence_fields:
      invoice.field_confidence
        ? lowConfidenceFields(
            JSON.parse(
              invoice.field_confidence
            )
          )
        : [],

    line_items:
      lineItems,

    validation_results:
      validation,

    documents:
      documents,

    processing_logs:
      logs.map(
        l => ({
          ...l,

          detail:
            l.detail
              ? JSON.parse(
                  l.detail
                )
              : null
        })
      ),

    processed_by_name:
      processedBy
        ? processedBy.name
        : null,

    created_by_name:
      createdBy
        ? createdBy.name
        : null
  };
}

// ===========================================================================
// GET /api/invoices
// ===========================================================================

router.get(
  '/',
  requireAuth,
  (req, res) => {

    const {
      q,
      status,
      dateFrom,
      dateTo
    } = req.query;

    let sql =
      'SELECT * FROM invoices WHERE 1=1';

    const params = [];

    if (
      status &&
      status !== 'all'
    ) {

      sql +=
        ' AND status = ?';

      params.push(
        status
      );
    }

    if (dateFrom) {

      sql +=
        ' AND date(invoice_date) >= date(?)';

      params.push(
        dateFrom
      );
    }

    if (dateTo) {

      sql +=
        ' AND date(invoice_date) <= date(?)';

      params.push(
        dateTo
      );
    }

    if (q) {

      sql += `
        AND (
          invoice_number LIKE ?
          OR supplier_name LIKE ?
          OR supplier_vat_number LIKE ?
          OR purchase_order_number LIKE ?
          OR CAST(total_amount AS TEXT) LIKE ?
        )
      `;

      const like =
        `%${q}%`;

      params.push(
        like,
        like,
        like,
        like,
        like
      );
    }

    sql +=
      ' ORDER BY created_at DESC LIMIT 500';

    const rows =
      db.prepare(sql).all(
        ...params
      );

    res.json({
      invoices:
        rows
    });
  }
);

// ===========================================================================
// GET /api/invoices/:id
// ===========================================================================

router.get(
  '/:id',
  requireAuth,
  (req, res) => {

    const invoice =
      getInvoiceFull(
        req.params.id
      );

    if (!invoice) {

      return res.status(404).json({
        error:
          'Invoice not found'
      });
    }

    res.json({
      invoice
    });
  }
);

// ===========================================================================
// GET /api/invoices/:id/document
// ===========================================================================

router.get(
  '/:id/document',
  requireAuth,
  (req, res) => {

    const doc =
      db.prepare(`
        SELECT *
        FROM invoice_documents
        WHERE invoice_id = ?
        ORDER BY uploaded_at DESC
        LIMIT 1
      `).get(req.params.id);

    if (!doc) {

      return res.status(404).json({
        error:
          'Document not found'
      });
    }

    res.sendFile(
      path.join(
        __dirname,
        '..',
        doc.file_path
      )
    );
  }
);

// ===========================================================================
// PATCH /api/invoices/:id
// ===========================================================================

const EDITABLE_FIELDS = [

  'invoice_number',

  'supplier_name',

  'supplier_vat_number',

  'invoice_date',

  'due_date',

  'purchase_order_number',

  'subtotal',

  'vat_amount',

  'total_amount',

  'currency',

  'payment_terms',

  'supplier_address',

  'supplier_contact'

];

router.patch(
  '/:id',
  requireAuth,
  (req, res) => {

    const invoice =
      db.prepare(`
        SELECT *
        FROM invoices
        WHERE id = ?
      `).get(req.params.id);

    if (!invoice) {

      return res.status(404).json({
        error:
          'Invoice not found'
      });
    }

    const updates = {};
    const changes = [];

    for (
      const field of EDITABLE_FIELDS
    ) {

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          field
        )
      ) {

        const newVal =
          req.body[field];

        if (
          String(invoice[field]) !==
          String(newVal)
        ) {

          changes.push({
            field,

            old:
              invoice[field],

            new:
              newVal
          });
        }

        updates[field] =
          newVal;
      }
    }

    if (
      !Object.keys(updates).length
    ) {

      return res.status(400).json({
        error:
          'No editable fields provided'
      });
    }

    const setClause =
      Object.keys(updates)
        .map(
          key =>
            `${key} = ?`
        )
        .join(', ');

    db.prepare(`
      UPDATE invoices
      SET
        ${setClause},
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      ...Object.values(updates),
      req.params.id
    );

    if (changes.length) {

      log(
        req.params.id,
        'field_edited',
        req.user.id,
        {
          changes
        }
      );
    }

    // Re-run validation
    const refreshed =
      db.prepare(`
        SELECT *
        FROM invoices
        WHERE id = ?
      `).get(req.params.id);

    const others =
      db.prepare(`
        SELECT
          id,
          invoice_number,
          supplier_name,
          total_amount
        FROM invoices
        WHERE id != ?
      `).all(req.params.id);

    const validationResults =
      validateInvoice(
        refreshed,
        others
      );

    db.prepare(`
      DELETE FROM invoice_validation_results
      WHERE invoice_id = ?
    `).run(req.params.id);

    for (
      const vr of validationResults
    ) {

      db.prepare(`
        INSERT INTO invoice_validation_results
          (
            id,
            invoice_id,
            rule_code,
            passed,
            severity,
            message
          )
        VALUES
          (?, ?, ?, ?, ?, ?)
      `).run(

        uuid(),

        req.params.id,

        vr.rule_code,

        vr.passed
          ? 1
          : 0,

        vr.severity,

        vr.message
      );
    }

    const confidence =
      refreshed.field_confidence
        ? JSON.parse(
            refreshed.field_confidence
          )
        : {};

    const newStatus =
      [
        'approved',
        'rejected'
      ].includes(
        refreshed.status
      )
        ? refreshed.status
        : overallStatus(
            validationResults,
            confidence
          );

    db.prepare(`
      UPDATE invoices
      SET status = ?
      WHERE id = ?
    `).run(
      newStatus,
      req.params.id
    );

    res.json({
      invoice:
        getInvoiceFull(
          req.params.id
        )
    });
  }
);

// ===========================================================================
// APPROVE
// ===========================================================================

router.post(
  '/:id/approve',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  (req, res) => {

    const invoice =
      db.prepare(`
        SELECT *
        FROM invoices
        WHERE id = ?
      `).get(req.params.id);

    if (!invoice) {

      return res.status(404).json({
        error:
          'Invoice not found'
      });
    }

    db.prepare(`
      UPDATE invoices
      SET
        status='approved',
        processed_by=?,
        processed_at=datetime('now'),
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      req.user.id,
      req.params.id
    );

    log(
      req.params.id,
      'approved',
      req.user.id,
      null
    );

    res.json({
      invoice:
        getInvoiceFull(
          req.params.id
        )
    });
  }
);

// ===========================================================================
// REJECT
// ===========================================================================

router.post(
  '/:id/reject',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  (req, res) => {

    const invoice =
      db.prepare(`
        SELECT *
        FROM invoices
        WHERE id = ?
      `).get(req.params.id);

    if (!invoice) {

      return res.status(404).json({
        error:
          'Invoice not found'
      });
    }

    db.prepare(`
      UPDATE invoices
      SET
        status='rejected',
        processed_by=?,
        processed_at=datetime('now'),
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      req.user.id,
      req.params.id
    );

    log(
      req.params.id,
      'rejected',
      req.user.id,
      {
        reason:
          req.body?.reason || null
      }
    );

    res.json({
      invoice:
        getInvoiceFull(
          req.params.id
        )
    });
  }
);

// ===========================================================================
// RETRY
// ===========================================================================

router.post(
  '/:id/retry',
  requireAuth,
  upload.single('file'),
  async (req, res) => {

    const invoice =
      db.prepare(`
        SELECT *
        FROM invoices
        WHERE id = ?
      `).get(req.params.id);

    if (!invoice) {

      return res.status(404).json({
        error:
          'Invoice not found'
      });
    }

    if (!req.file) {

      return res.status(400).json({
        error:
          'No file uploaded'
      });
    }

    // Make sure retrying user exists
    const user =
      db.prepare(`
        SELECT id
        FROM users
        WHERE id = ?
      `).get(req.user.id);

    if (!user) {

      return res.status(401).json({
        error:
          'Your login session is no longer valid. Please log out and log in again.'
      });
    }

    try {

      console.log(
        `[retry] Starting AI extraction for invoice ${req.params.id}`
      );

      const extraction =
        await extractInvoice(
          req.file.path,
          req.file.mimetype
        );

      console.log(
        `[retry] AI extraction completed using provider: ${extraction.provider}`
      );

      const others =
        db.prepare(`
          SELECT
            id,
            invoice_number,
            supplier_name,
            total_amount
          FROM invoices
          WHERE id != ?
        `).all(req.params.id);

      const validationResults =
        validateInvoice(
          extraction.fields,
          others
        );

      const status =
        overallStatus(
          validationResults,
          extraction.confidence
        );

      const f =
        extraction.fields;

      const supplierId =
        findOrCreateSupplier(
          f.supplier_name,
          f.supplier_vat_number,
          f.supplier_address,
          f.supplier_contact
        );

      db.prepare(`
        UPDATE invoices SET

          invoice_number=?,
          supplier_id=?,
          supplier_name=?,
          supplier_vat_number=?,
          supplier_address=?,
          supplier_contact=?,

          invoice_date=?,
          due_date=?,
          purchase_order_number=?,

          subtotal=?,
          vat_amount=?,
          total_amount=?,

          currency=?,
          payment_terms=?,

          status=?,
          overall_confidence=?,
          field_confidence=?,

          updated_at=datetime('now')

        WHERE id=?
      `).run(

        f.invoice_number,

        supplierId,

        f.supplier_name,

        f.supplier_vat_number,

        f.supplier_address,

        f.supplier_contact,

        f.invoice_date,

        f.due_date,

        f.purchase_order_number,

        f.subtotal,

        f.vat_amount,

        f.total_amount,

        f.currency,

        f.payment_terms,

        status,

        avgConfidence(
          extraction.confidence
        ),

        JSON.stringify(
          extraction.confidence
        ),

        req.params.id
      );

      // Replace line items
      db.prepare(`
        DELETE FROM invoice_line_items
        WHERE invoice_id = ?
      `).run(req.params.id);

      for (
        const li of extraction.lineItems
      ) {

        db.prepare(`
          INSERT INTO invoice_line_items
            (
              id,
              invoice_id,
              description,
              quantity,
              unit_price,
              vat,
              total
            )
          VALUES
            (?, ?, ?, ?, ?, ?, ?)
        `).run(

          uuid(),

          req.params.id,

          li.description,

          li.quantity,

          li.unit_price,

          li.vat,

          li.total
        );
      }

      // Replace validation
      db.prepare(`
        DELETE FROM invoice_validation_results
        WHERE invoice_id = ?
      `).run(req.params.id);

      for (
        const vr of validationResults
      ) {

        db.prepare(`
          INSERT INTO invoice_validation_results
            (
              id,
              invoice_id,
              rule_code,
              passed,
              severity,
              message
            )
          VALUES
            (?, ?, ?, ?, ?, ?)
        `).run(

          uuid(),

          req.params.id,

          vr.rule_code,

          vr.passed
            ? 1
            : 0,

          vr.severity,

          vr.message
        );
      }

      // Save new document
      db.prepare(`
        INSERT INTO invoice_documents
          (
            id,
            invoice_id,
            file_path,
            original_filename,
            mime_type
          )
        VALUES
          (?, ?, ?, ?, ?)
      `).run(

        uuid(),

        req.params.id,

        path.relative(
          path.join(__dirname, '..'),
          req.file.path
        ),

        req.file.originalname,

        req.file.mimetype
      );

      log(
        req.params.id,
        'retried',
        req.user.id,
        {
          provider:
            extraction.provider
        }
      );

      res.json({
        invoice:
          getInvoiceFull(
            req.params.id
          )
      });

    } catch (err) {

      console.error(
        '[retry]',
        err
      );

      res.status(500).json({
        error:
          `Retry failed: ${err.message}`
      });
    }
  }
);

// ===========================================================================
// EXPORTS
// ===========================================================================

module.exports = {
  router,
  getInvoiceFull
};

