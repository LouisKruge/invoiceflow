// ============================================================================
// InvoiceFlow — Invoice Routes
// PostgreSQL / Neon version
// ============================================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

const db = require('../db');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth');

const {
  extractInvoice
} = require('../services/aiExtraction');

const {
  validateInvoice,
  overallStatus,
  lowConfidenceFields
} = require('../services/validation');

const router = express.Router();

// ============================================================================
// UPLOAD CONFIGURATION
// ============================================================================

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

// ============================================================================
// HELPERS
// ============================================================================

async function log(
  invoiceId,
  stage,
  actorId,
  detail
) {

  await db.run(
    `
      INSERT INTO invoice_processing_logs
      (
        id,
        invoice_id,
        stage,
        actor_id,
        detail
      )
      VALUES
      ($1, $2, $3, $4, $5)
    `,
    [
      uuid(),
      invoiceId,
      stage,
      actorId || null,
      detail
        ? JSON.stringify(detail)
        : null
    ]
  );

}

// ============================================================================
// SUPPLIER
// ============================================================================

async function findOrCreateSupplier(
  name,
  vat,
  address,
  contact
) {

  if (!name) {
    return null;
  }

  const key =
    `${String(name).trim().toLowerCase()}|${String(vat || '')
      .trim()
      .toLowerCase()}`;

  const existing =
    await db.get(
      `
        SELECT *
        FROM suppliers
        WHERE normalized_key = $1
        LIMIT 1
      `,
      [key]
    );

  if (existing) {
    return existing.id;
  }

  const id = uuid();

  await db.run(
    `
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
      ($1, $2, $3, $4, $5, $6)
    `,
    [
      id,
      name,
      vat || null,
      address || null,
      contact || null,
      key
    ]
  );

  return id;

}

// ============================================================================
// CONFIDENCE
// ============================================================================

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

// ============================================================================
// VALIDATION PASSED VALUE
// ============================================================================
// IMPORTANT:
// PostgreSQL schema uses INTEGER for invoice_validation_results.passed.
//
// Therefore:
//   true  -> 1
//   false -> 0
//
// Never insert JavaScript booleans into this column.
// ============================================================================

function validationPassedValue(value) {

  return value ? 1 : 0;

}

// ============================================================================
// GET FULL INVOICE
// ============================================================================

async function getInvoiceFull(
  id
) {

  const invoice =
    await db.get(
      `
        SELECT *
        FROM invoices
        WHERE id = $1
      `,
      [id]
    );

  if (!invoice) {
    return null;
  }

  // --------------------------------------------------------------------------
  // LINE ITEMS
  // IMPORTANT:
  // Do NOT use created_at here.
  // The current database schema does not contain created_at on this table.
  // --------------------------------------------------------------------------

  const lineItems =
    await db.all(
      `
        SELECT *
        FROM invoice_line_items
        WHERE invoice_id = $1
        ORDER BY id ASC
      `,
      [id]
    );

  // --------------------------------------------------------------------------
  // VALIDATION RESULTS
  // IMPORTANT:
  // Do NOT use created_at here.
  // --------------------------------------------------------------------------

  const validation =
    await db.all(
      `
        SELECT *
        FROM invoice_validation_results
        WHERE invoice_id = $1
        ORDER BY id ASC
      `,
      [id]
    );

  // --------------------------------------------------------------------------
  // DOCUMENTS
  // uploaded_at is used because this table has uploaded_at.
  // --------------------------------------------------------------------------

  const documents =
    await db.all(
      `
        SELECT *
        FROM invoice_documents
        WHERE invoice_id = $1
        ORDER BY uploaded_at DESC
      `,
      [id]
    );

  // --------------------------------------------------------------------------
  // PROCESSING LOGS
  // IMPORTANT:
  // Do NOT use created_at here.
  // --------------------------------------------------------------------------

  const logs =
    await db.all(
      `
        SELECT
          l.*,
          u.name AS actor_name
        FROM invoice_processing_logs l
        LEFT JOIN users u
          ON u.id = l.actor_id
        WHERE l.invoice_id = $1
        ORDER BY l.id ASC
      `,
      [id]
    );

  // --------------------------------------------------------------------------
  // PROCESSED BY
  // --------------------------------------------------------------------------

  let processedBy = null;

  if (invoice.processed_by) {

    processedBy =
      await db.get(
        `
          SELECT name
          FROM users
          WHERE id = $1
        `,
        [invoice.processed_by]
      );

  }

  // --------------------------------------------------------------------------
  // CREATED BY
  // --------------------------------------------------------------------------

  let createdBy = null;

  if (invoice.created_by) {

    createdBy =
      await db.get(
        `
          SELECT name
          FROM users
          WHERE id = $1
        `,
        [invoice.created_by]
      );

  }

  // --------------------------------------------------------------------------
  // FIELD CONFIDENCE
  // --------------------------------------------------------------------------

  let fieldConfidence = {};

  if (invoice.field_confidence) {

    try {

      fieldConfidence =
        typeof invoice.field_confidence === 'string'
          ? JSON.parse(invoice.field_confidence)
          : invoice.field_confidence;

    } catch (error) {

      fieldConfidence = {};

    }

  }

  // --------------------------------------------------------------------------
  // RETURN COMPLETE INVOICE
  // --------------------------------------------------------------------------

  return {

    ...invoice,

    field_confidence:
      fieldConfidence,

    low_confidence_fields:
      lowConfidenceFields(
        fieldConfidence
      ),

    line_items:
      lineItems,

    validation_results:
      validation,

    documents:
      documents,

    processing_logs:
      logs.map(
        l => {

          let detail = null;

          if (l.detail) {

            try {

              detail =
                typeof l.detail === 'string'
                  ? JSON.parse(l.detail)
                  : l.detail;

            } catch (error) {

              detail =
                l.detail;

            }

          }

          return {
            ...l,
            detail
          };

        }
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

// ============================================================================
// POST /api/invoices/capture
// ============================================================================

router.post(
  '/capture',
  requireAuth,
  upload.single('file'),
  async (req, res) => {

    // ------------------------------------------------------------------------
    // FILE CHECK
    // ------------------------------------------------------------------------

    if (!req.file) {

      return res.status(400).json({
        error:
          'No file uploaded'
      });

    }

    // ------------------------------------------------------------------------
    // VERIFY AUTHENTICATED USER
    // ------------------------------------------------------------------------

    const user =
      await db.get(
        `
          SELECT
            id,
            name,
            role
          FROM users
          WHERE id = $1
        `,
        [req.user.id]
      );

    if (!user) {

      console.error(
        '[capture] Authenticated user does not exist:',
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

    const invoiceId = uuid();

    const filePath =
      req.file.path;

    // ------------------------------------------------------------------------
    // CREATE INVOICE
    // ------------------------------------------------------------------------

    try {

      await db.run(
        `
          INSERT INTO invoices
          (
            id,
            status,
            created_by
          )
          VALUES
          ($1, $2, $3)
        `,
        [
          invoiceId,
          'processing',
          user.id
        ]
      );

      await db.run(
        `
          INSERT INTO invoice_documents
          (
            id,
            invoice_id,
            file_path,
            original_filename,
            mime_type
          )
          VALUES
          ($1, $2, $3, $4, $5)
        `,
        [
          uuid(),

          invoiceId,

          path.relative(
            path.join(
              __dirname,
              '..'
            ),
            filePath
          ),

          req.file.originalname,

          req.file.mimetype
        ]
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

    // ------------------------------------------------------------------------
    // PROCESS INVOICE
    // ------------------------------------------------------------------------

    try {

      await log(
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
          `[capture] AI provider warning: ${extraction.error}`
        );

      }

      await log(
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

      // ----------------------------------------------------------------------
      // EXISTING INVOICES
      // ----------------------------------------------------------------------

      const existing =
        await db.all(
          `
            SELECT
              id,
              invoice_number,
              supplier_name,
              total_amount
            FROM invoices
            WHERE id != $1
          `,
          [invoiceId]
        );

      // ----------------------------------------------------------------------
      // VALIDATION
      // ----------------------------------------------------------------------

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

      await log(
        invoiceId,
        'validated',
        null,
        {
          status
        }
      );

      // ----------------------------------------------------------------------
      // SUPPLIER
      // ----------------------------------------------------------------------

      const supplierId =
        await findOrCreateSupplier(
          extraction.fields.supplier_name,
          extraction.fields.supplier_vat_number,
          extraction.fields.supplier_address,
          extraction.fields.supplier_contact
        );

      // ----------------------------------------------------------------------
      // SAVE INVOICE
      // ----------------------------------------------------------------------

      const f =
        extraction.fields;

      await db.run(
        `
          UPDATE invoices
          SET

            invoice_number = $1,
            supplier_id = $2,
            supplier_name = $3,
            supplier_vat_number = $4,
            supplier_address = $5,
            supplier_contact = $6,

            invoice_date = $7,
            due_date = $8,
            purchase_order_number = $9,

            subtotal = $10,
            vat_amount = $11,
            total_amount = $12,

            currency = $13,
            payment_terms = $14,

            status = $15,
            overall_confidence = $16,
            field_confidence = $17,
            ai_raw_response = $18,

            updated_at = NOW()

          WHERE id = $19
        `,
        [

          f.invoice_number || null,

          supplierId,

          f.supplier_name || null,

          f.supplier_vat_number || null,

          f.supplier_address || null,

          f.supplier_contact || null,

          f.invoice_date || null,

          f.due_date || null,

          f.purchase_order_number || null,

          f.subtotal ?? null,

          f.vat_amount ?? null,

          f.total_amount ?? null,

          f.currency || null,

          f.payment_terms || null,

          status,

          avgConfidence(
            extraction.confidence
          ),

          JSON.stringify(
            extraction.confidence || {}
          ),

          JSON.stringify({
            provider:
              extraction.provider,

            error:
              extraction.error || null
          }),

          invoiceId

        ]
      );

      // ----------------------------------------------------------------------
      // LINE ITEMS
      // ----------------------------------------------------------------------

      for (
        const li of (
          extraction.lineItems || []
        )
      ) {

        await db.run(
          `
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
            ($1, $2, $3, $4, $5, $6, $7)
          `,
          [

            uuid(),

            invoiceId,

            li.description || null,

            li.quantity ?? null,

            li.unit_price ?? null,

            li.vat ?? null,

            li.total ?? null

          ]
        );

      }

      // ----------------------------------------------------------------------
      // VALIDATION RESULTS
      // IMPORTANT:
      // passed is INTEGER in PostgreSQL.
      // Use 1 / 0 instead of true / false.
      // ----------------------------------------------------------------------

      for (
        const vr of validationResults
      ) {

        await db.run(
          `
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
            ($1, $2, $3, $4, $5, $6)
          `,
          [

            uuid(),

            invoiceId,

            vr.rule_code,

            validationPassedValue(
              vr.passed
            ),

            vr.severity,

            vr.message

          ]
        );

      }

      // ----------------------------------------------------------------------
      // SUCCESS
      // ----------------------------------------------------------------------

      console.log(
        `[capture] Invoice ${invoiceId} successfully processed`
      );

      const completeInvoice =
        await getInvoiceFull(
          invoiceId
        );

      return res.json({

        invoice:
          completeInvoice

      });

    } catch (err) {

      console.error(
        '[capture] Invoice processing failed:',
        err
      );

      // ----------------------------------------------------------------------
      // FALLBACK STATUS UPDATE
      // ----------------------------------------------------------------------

      try {

        await db.run(
          `
            UPDATE invoices
            SET
              status = 'exception',
              updated_at = NOW()
            WHERE id = $1
          `,
          [invoiceId]
        );

      } catch (fallbackError) {

        console.error(
          '[capture/status-fallback]',
          fallbackError
        );

      }

      // ----------------------------------------------------------------------
      // FALLBACK VALIDATION RECORD
      // IMPORTANT:
      // passed is INTEGER -> use 0.
      // ----------------------------------------------------------------------

      try {

        await db.run(
          `
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
            ($1, $2, $3, $4, $5, $6)
          `,
          [

            uuid(),

            invoiceId,

            'PROCESSING_ERROR',

            0,

            'error',

            `We couldn't confidently read this invoice: ${err.message}`

          ]
        );

      } catch (fallbackError) {

        console.error(
          '[capture/validation-fallback]',
          fallbackError
        );

      }

      // ----------------------------------------------------------------------
      // FALLBACK LOG
      // ----------------------------------------------------------------------

      try {

        await log(
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
          '[capture/log-fallback]',
          fallbackError
        );

      }

      // ----------------------------------------------------------------------
      // TRY TO RETURN THE INVOICE
      // ----------------------------------------------------------------------

      try {

        const failedInvoice =
          await getInvoiceFull(
            invoiceId
          );

        return res.status(200).json({

          invoice:
            failedInvoice,

          warning:
            "We couldn't confidently read this invoice. Please review and enter the details manually, or retake the photo."

        });

      } catch (finalError) {

        console.error(
          '[capture/final-response]',
          finalError
        );

        return res.status(500).json({

          error:
            `Invoice processing failed: ${err.message}`

        });

      }

    }

  }
);

// ============================================================================
// GET /api/invoices
// ============================================================================

router.get(
  '/',
  requireAuth,
  async (req, res) => {

    try {

      const {
        q,
        status,
        dateFrom,
        dateTo
      } = req.query;

      let sql =
        `
          SELECT *
          FROM invoices
          WHERE 1 = 1
        `;

      const params = [];

      // ----------------------------------------------------------------------
      // STATUS
      // ----------------------------------------------------------------------

      if (
        status &&
        status !== 'all'
      ) {

        params.push(status);

        sql +=
          ` AND status = $${params.length}`;

      }

      // ----------------------------------------------------------------------
      // DATE FROM
      // ----------------------------------------------------------------------

      if (dateFrom) {

        params.push(dateFrom);

        sql +=
          ` AND DATE(invoice_date) >= DATE($${params.length})`;

      }

      // ----------------------------------------------------------------------
      // DATE TO
      // ----------------------------------------------------------------------

      if (dateTo) {

        params.push(dateTo);

        sql +=
          ` AND DATE(invoice_date) <= DATE($${params.length})`;

      }

      // ----------------------------------------------------------------------
      // SEARCH
      // ----------------------------------------------------------------------

      if (q) {

        const search =
          `%${q}%`;

        params.push(search);

        const p =
          `$${params.length}`;

        sql += `
          AND (
            invoice_number ILIKE ${p}
            OR supplier_name ILIKE ${p}
            OR supplier_vat_number ILIKE ${p}
            OR purchase_order_number ILIKE ${p}
            OR CAST(total_amount AS TEXT) ILIKE ${p}
          )
        `;

      }

      // ----------------------------------------------------------------------
      // IMPORTANT:
      // created_at DOES NOT EXIST.
      //
      // updated_at is used instead.
      // ----------------------------------------------------------------------

      sql +=
        `
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 500
        `;

      const invoices =
        await db.all(
          sql,
          params
        );

      return res.json({
        invoices
      });

    } catch (error) {

      console.error(
        '[invoices/list]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to load invoices: ${error.message}`
      });

    }

  }
);

// ============================================================================
// GET /api/invoices/:id
// ============================================================================

router.get(
  '/:id',
  requireAuth,
  async (req, res) => {

    try {

      const invoice =
        await getInvoiceFull(
          req.params.id
        );

      if (!invoice) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      return res.json({
        invoice
      });

    } catch (error) {

      console.error(
        '[invoices/get]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to load invoice: ${error.message}`
      });

    }

  }
);

// ============================================================================
// GET /api/invoices/:id/document
// ============================================================================

router.get(
  '/:id/document',
  requireAuth,
  async (req, res) => {

    try {

      const doc =
        await db.get(
          `
            SELECT *
            FROM invoice_documents
            WHERE invoice_id = $1
            ORDER BY uploaded_at DESC
            LIMIT 1
          `,
          [req.params.id]
        );

      if (!doc) {

        return res.status(404).json({
          error:
            'Document not found'
        });

      }

      const absolutePath =
        path.join(
          __dirname,
          '..',
          doc.file_path
        );

      if (!fs.existsSync(absolutePath)) {

        return res.status(404).json({
          error:
            'Invoice document file could not be found on the server'
        });

      }

      return res.sendFile(
        absolutePath
      );

    } catch (error) {

      console.error(
        '[invoices/document]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to load invoice document: ${error.message}`
      });

    }

  }
);

// ============================================================================
// EDITABLE FIELDS
// ============================================================================

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

// ============================================================================
// PATCH /api/invoices/:id
// ============================================================================

router.patch(
  '/:id',
  requireAuth,
  async (req, res) => {

    try {

      const invoice =
        await db.get(
          `
            SELECT *
            FROM invoices
            WHERE id = $1
          `,
          [req.params.id]
        );

      if (!invoice) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      const updates = {};
      const changes = [];

      // ----------------------------------------------------------------------
      // COLLECT EDITS
      // ----------------------------------------------------------------------

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

      const fields =
        Object.keys(updates);

      const values =
        Object.values(updates);

      const setParts =
        fields.map(
          (field, index) =>
            `${field} = $${index + 1}`
        );

      values.push(
        req.params.id
      );

      await db.run(
        `
          UPDATE invoices
          SET
            ${setParts.join(', ')},
            updated_at = NOW()
          WHERE id = $${values.length}
        `,
        values
      );

      // ----------------------------------------------------------------------
      // LOG FIELD CHANGES
      // ----------------------------------------------------------------------

      if (changes.length) {

        await log(
          req.params.id,
          'field_edited',
          req.user.id,
          {
            changes
          }
        );

      }

      // ----------------------------------------------------------------------
      // RE-RUN VALIDATION
      // ----------------------------------------------------------------------

      const refreshed =
        await db.get(
          `
            SELECT *
            FROM invoices
            WHERE id = $1
          `,
          [req.params.id]
        );

      const others =
        await db.all(
          `
            SELECT
              id,
              invoice_number,
              supplier_name,
              total_amount
            FROM invoices
            WHERE id != $1
          `,
          [req.params.id]
        );

      const validationResults =
        validateInvoice(
          refreshed,
          others
        );

      // ----------------------------------------------------------------------
      // DELETE OLD VALIDATION
      // ----------------------------------------------------------------------

      await db.run(
        `
          DELETE FROM invoice_validation_results
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      // ----------------------------------------------------------------------
      // SAVE NEW VALIDATION
      // IMPORTANT:
      // passed is INTEGER -> use 1 / 0.
      // ----------------------------------------------------------------------

      for (
        const vr of validationResults
      ) {

        await db.run(
          `
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
            ($1, $2, $3, $4, $5, $6)
          `,
          [

            uuid(),

            req.params.id,

            vr.rule_code,

            validationPassedValue(
              vr.passed
            ),

            vr.severity,

            vr.message

          ]
        );

      }

      // ----------------------------------------------------------------------
      // CONFIDENCE
      // ----------------------------------------------------------------------

      let confidence = {};

      if (refreshed.field_confidence) {

        try {

          confidence =
            typeof refreshed.field_confidence === 'string'
              ? JSON.parse(refreshed.field_confidence)
              : refreshed.field_confidence;

        } catch (error) {

          confidence = {};

        }

      }// ===========================================================================
// DELETE API ROUTE
// ADD THIS TO routes/invoices.js
// ===========================================================================

router.delete(
  '/:id',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  async (req, res) => {

    try {

      const invoice =
        await db.get(
          `
            SELECT *
            FROM invoices
            WHERE id = $1
          `,
          [req.params.id]
        );

      if (!invoice) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      await db.run(
        `
          DELETE FROM invoice_validation_results
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      await db.run(
        `
          DELETE FROM invoice_line_items
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      await db.run(
        `
          DELETE FROM invoice_processing_logs
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      await db.run(
        `
          DELETE FROM invoice_documents
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      await db.run(
        `
          DELETE FROM invoices
          WHERE id = $1
        `,
        [req.params.id]
      );

      return res.json({
        success: true,
        id: req.params.id
      });

    } catch (error) {

      console.error(
        '[invoices/delete]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to delete invoice: ${error.message}`
      });

    }

  }
);

      // ----------------------------------------------------------------------
      // STATUS
      // ----------------------------------------------------------------------

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

      await db.run(
        `
          UPDATE invoices
          SET
            status = $1,
            updated_at = NOW()
          WHERE id = $2
        `,
        [
          newStatus,
          req.params.id
        ]
      );

      return res.json({

        invoice:
          await getInvoiceFull(
            req.params.id
          )

      });

    } catch (error) {

      console.error(
        '[invoices/update]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to update invoice: ${error.message}`
      });

    }

  }
);

// ============================================================================
// APPROVE
// ============================================================================

router.post(
  '/:id/approve',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  async (req, res) => {

    try {

      const invoice =
        await db.get(
          `
            SELECT *
            FROM invoices
            WHERE id = $1
          `,
          [req.params.id]
        );

      if (!invoice) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      await db.run(
        `
          UPDATE invoices
          SET
            status = 'approved',
            processed_by = $1,
            processed_at = NOW(),
            updated_at = NOW()
          WHERE id = $2
        `,
        [
          req.user.id,
          req.params.id
        ]
      );

      await log(
        req.params.id,
        'approved',
        req.user.id,
        null
      );

      return res.json({

        invoice:
          await getInvoiceFull(
            req.params.id
          )

      });

    } catch (error) {

      console.error(
        '[invoices/approve]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to approve invoice: ${error.message}`
      });

    }

  }
);

// ============================================================================
// REJECT
// ============================================================================

router.post(
  '/:id/reject',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  async (req, res) => {

    try {

      const invoice =
        await db.get(
          `
            SELECT *
            FROM invoices
            WHERE id = $1
          `,
          [req.params.id]
        );

      if (!invoice) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      await db.run(
        `
          UPDATE invoices
          SET
            status = 'rejected',
            processed_by = $1,
            processed_at = NOW(),
            updated_at = NOW()
          WHERE id = $2
        `,
        [
          req.user.id,
          req.params.id
        ]
      );

      await log(
        req.params.id,
        'rejected',
        req.user.id,
        {
          reason:
            req.body?.reason || null
        }
      );

      return res.json({

        invoice:
          await getInvoiceFull(
            req.params.id
          )

      });

    } catch (error) {

      console.error(
        '[invoices/reject]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to reject invoice: ${error.message}`
      });

    }

  }
);

// ============================================================================
// RETRY
// ============================================================================

router.post(
  '/:id/retry',
  requireAuth,
  upload.single('file'),
  async (req, res) => {

    try {

      // ----------------------------------------------------------------------
      // FIND INVOICE
      // ----------------------------------------------------------------------

      const invoice =
        await db.get(
          `
            SELECT *
            FROM invoices
            WHERE id = $1
          `,
          [req.params.id]
        );

      if (!invoice) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      // ----------------------------------------------------------------------
      // FILE CHECK
      // ----------------------------------------------------------------------

      if (!req.file) {

        return res.status(400).json({
          error:
            'No file uploaded'
        });

      }

      // ----------------------------------------------------------------------
      // VERIFY USER
      // ----------------------------------------------------------------------

      const user =
        await db.get(
          `
            SELECT id
            FROM users
            WHERE id = $1
          `,
          [req.user.id]
        );

      if (!user) {

        return res.status(401).json({
          error:
            'Your login session is no longer valid. Please log out and log in again.'
        });

      }

      // ----------------------------------------------------------------------
      // AI EXTRACTION
      // ----------------------------------------------------------------------

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

      // ----------------------------------------------------------------------
      // EXISTING INVOICES
      // ----------------------------------------------------------------------

      const others =
        await db.all(
          `
            SELECT
              id,
              invoice_number,
              supplier_name,
              total_amount
            FROM invoices
            WHERE id != $1
          `,
          [req.params.id]
        );

      // ----------------------------------------------------------------------
      // VALIDATION
      // ----------------------------------------------------------------------

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

      // ----------------------------------------------------------------------
      // SUPPLIER
      // ----------------------------------------------------------------------

      const supplierId =
        await findOrCreateSupplier(
          f.supplier_name,
          f.supplier_vat_number,
          f.supplier_address,
          f.supplier_contact
        );

      // ----------------------------------------------------------------------
      // UPDATE INVOICE
      // ----------------------------------------------------------------------

      await db.run(
        `
          UPDATE invoices
          SET

            invoice_number = $1,
            supplier_id = $2,
            supplier_name = $3,
            supplier_vat_number = $4,
            supplier_address = $5,
            supplier_contact = $6,

            invoice_date = $7,
            due_date = $8,
            purchase_order_number = $9,

            subtotal = $10,
            vat_amount = $11,
            total_amount = $12,

            currency = $13,
            payment_terms = $14,

            status = $15,
            overall_confidence = $16,
            field_confidence = $17,

            updated_at = NOW()

          WHERE id = $18
        `,
        [

          f.invoice_number || null,

          supplierId,

          f.supplier_name || null,

          f.supplier_vat_number || null,

          f.supplier_address || null,

          f.supplier_contact || null,

          f.invoice_date || null,

          f.due_date || null,

          f.purchase_order_number || null,

          f.subtotal ?? null,

          f.vat_amount ?? null,

          f.total_amount ?? null,

          f.currency || null,

          f.payment_terms || null,

          status,

          avgConfidence(
            extraction.confidence
          ),

          JSON.stringify(
            extraction.confidence || {}
          ),

          req.params.id

        ]
      );

      // ----------------------------------------------------------------------
      // REPLACE LINE ITEMS
      // ----------------------------------------------------------------------

      await db.run(
        `
          DELETE FROM invoice_line_items
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      for (
        const li of (
          extraction.lineItems || []
        )
      ) {

        await db.run(
          `
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
            ($1, $2, $3, $4, $5, $6, $7)
          `,
          [

            uuid(),

            req.params.id,

            li.description || null,

            li.quantity ?? null,

            li.unit_price ?? null,

            li.vat ?? null,

            li.total ?? null

          ]
        );

      }

      // ----------------------------------------------------------------------
      // REPLACE VALIDATION
      // IMPORTANT:
      // passed is INTEGER -> use 1 / 0.
      // ----------------------------------------------------------------------

      await db.run(
        `
          DELETE FROM invoice_validation_results
          WHERE invoice_id = $1
        `,
        [req.params.id]
      );

      for (
        const vr of validationResults
      ) {

        await db.run(
          `
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
            ($1, $2, $3, $4, $5, $6)
          `,
          [

            uuid(),

            req.params.id,

            vr.rule_code,

            validationPassedValue(
              vr.passed
            ),

            vr.severity,

            vr.message

          ]
        );

      }

      // ----------------------------------------------------------------------
      // SAVE NEW DOCUMENT
      // ----------------------------------------------------------------------

      await db.run(
        `
          INSERT INTO invoice_documents
          (
            id,
            invoice_id,
            file_path,
            original_filename,
            mime_type
          )
          VALUES
          ($1, $2, $3, $4, $5)
        `,
        [

          uuid(),

          req.params.id,

          path.relative(
            path.join(
              __dirname,
              '..'
            ),
            req.file.path
          ),

          req.file.originalname,

          req.file.mimetype

        ]
      );

      // ----------------------------------------------------------------------
      // LOG RETRY
      // ----------------------------------------------------------------------

      await log(
        req.params.id,
        'retried',
        req.user.id,
        {
          provider:
            extraction.provider
        }
      );

      // ----------------------------------------------------------------------
      // RETURN
      // ----------------------------------------------------------------------

      return res.json({

        invoice:
          await getInvoiceFull(
            req.params.id
          )

      });

    } catch (err) {

      console.error(
        '[retry]',
        err
      );

      return res.status(500).json({
        error:
          `Retry failed: ${err.message}`
      });

    }

  }
);

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  router,
  getInvoiceFull
};
