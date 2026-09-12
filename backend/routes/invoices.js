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

const invoiceStock = require('../services/invoiceStock');
const jobsService = require('../services/jobs');
const documentStore = require('../services/documentStore');

const {
  postInvoiceToStock
} = invoiceStock;

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
    // Checked here rather than only at boot: the directory is made once at
    // start-up, and on a host whose disk is swept underneath a running
    // process that is not enough.
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
    } catch (error) {
      return cb(error);
    }

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
  // INTELLIGENCE
  //
  // What the system can say about this invoice beyond the fields it read:
  // whether the supplier is known, whether the PO exists, and how the amount
  // compares with what this supplier has historically charged.
  // --------------------------------------------------------------------------

  const intelligence = [];

  // Supplier match
  intelligence.push(
    invoice.supplier_id
      ? {
          key: 'supplier_match',
          state: 'ok',
          title: 'Supplier matched',
          detail: invoice.supplier_name
        }
      : {
          key: 'supplier_match',
          state: 'missing',
          title: 'Supplier not matched',
          detail:
            'No supplier record is linked to this invoice.'
        }
  );

  // Account code
  intelligence.push(
    invoice.account_code
      ? {
          key: 'account_code',
          state: 'ok',
          title: 'Account code captured',
          detail: invoice.account_code
        }
      : {
          key: 'account_code',
          state: 'missing',
          title: 'No account code found',
          detail:
            'No customer account code was printed or read on this invoice.'
        }
  );

  // Purchase order match
  if (invoice.purchase_order_number) {

    const po =
      await db.get(
        `
          SELECT po_number, total_amount, status
          FROM purchase_orders
          WHERE po_number = $1
        `,
        [invoice.purchase_order_number]
      );

    intelligence.push(
      po
        ? {
            key: 'po_match',
            state: 'ok',
            title: 'Purchase order matched',
            detail: po.po_number
          }
        : {
            key: 'po_match',
            state: 'warning',
            title: 'Purchase order not on file',
            detail:
              `${invoice.purchase_order_number} is referenced on the ` +
              'invoice but does not exist in the purchase order register.'
          }
    );

  } else {

    intelligence.push({
      key: 'po_match',
      state: 'missing',
      title: 'No purchase order referenced',
      detail:
        'This invoice does not quote a purchase order number.'
    });

  }

  // Price variance against this supplier's history
  if (
    invoice.supplier_id &&
    invoice.total_amount != null
  ) {

    const history =
      await db.get(
        `
          SELECT
            AVG(total_amount) AS avg_total,
            COUNT(*)::int AS c
          FROM invoices
          WHERE supplier_id = $1
            AND id <> $2
            AND status != 'rejected'
            AND total_amount IS NOT NULL
        `,
        [invoice.supplier_id, id]
      );

    const priorAverage =
      history?.avg_total != null
        ? Number(history.avg_total)
        : null;

    // One prior invoice is not an average worth comparing against.
    if (
      priorAverage &&
      priorAverage > 0 &&
      Number(history.c) >= 2
    ) {

      const current =
        Number(invoice.total_amount);

      const difference =
        current - priorAverage;

      const pct =
        Math.round(
          (difference / priorAverage) * 1000
        ) / 10;

      intelligence.push({
        key: 'price_variance',
        state:
          Math.abs(pct) >= 15
            ? 'warning'
            : 'ok',
        title:
          Math.abs(pct) >= 15
            ? 'Price variance detected'
            : 'In line with supplier history',
        detail:
          Math.abs(pct) >= 15
            ? `This invoice is ${Math.abs(pct).toFixed(1)}% ` +
              `${difference > 0 ? 'higher' : 'lower'} than this ` +
              "supplier's previous average."
            : `Within ${Math.abs(pct).toFixed(1)}% of this ` +
              "supplier's previous average.",
        previous_average: priorAverage,
        current_amount: current,
        difference,
        variance_pct: pct,
        sample_size: Number(history.c)
      });

    }

  }

  // --------------------------------------------------------------------------
  // RETURN COMPLETE INVOICE
  // --------------------------------------------------------------------------

  return {

    ...invoice,

    intelligence,

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

    // Declared out here so the bytes can be kept once the row exists.
    let documentId = null;

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

      documentId = uuid();

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
          documentId,

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

    // Keep the bytes where the record is. The disk copy above does not survive
    // a restart; this one does. A failure here is logged, never fatal — the
    // invoice is still captured and the file is still on disk for now.
    await documentStore.keep('invoice_documents', documentId, filePath);

    // ------------------------------------------------------------------------
    // ANSWER NOW
    //
    // Everything above is fast: a file written and two rows inserted. What
    // follows — reading the document, matching a supplier, matching every line
    // against the product master — takes as long as the model takes, and there
    // is no reason to hold a phone on a building site open for it.
    //
    // The invoice exists and is addressable the moment this returns. Its
    // status says what is happening to it, exactly as a sign-out sheet's does,
    // and the screen follows that rather than a connection.
    //
    // Nothing below this line may touch res.
    // ------------------------------------------------------------------------

    res.status(202).json({

      invoice: {
        id: invoiceId,
        status: 'processing',
        created_at: new Date().toISOString(),
      },

      processing: true,

    });

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
            account_code = $10,

            subtotal = $11,
            vat_amount = $12,
            total_amount = $13,

            currency = $14,
            payment_terms = $15,

            status = $16,
            overall_confidence = $17,
            field_confidence = $18,
            ai_raw_response = $19,

            updated_at = NOW()

          WHERE id = $20
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

          f.account_code || null,

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
              total,
              supplier_product_code,
              unit_of_measure
            )
            VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [

            uuid(),

            invoiceId,

            li.description || null,

            li.quantity ?? null,

            li.unit_price ?? null,

            li.vat ?? null,

            li.total ?? null,

            li.supplier_product_code || null,

            li.unit_of_measure || null

          ]
        );

      }

      // Match the lines now, so the review screen can show what each one would
      // do to stock. This records a reading; it moves nothing.
      try {
        await invoiceStock.evaluateInvoiceLines(invoiceId);
      } catch (stockError) {
        console.warn(
          '[invoices] Could not evaluate stock lines:',
          stockError.message
        );
      }

      // Read the job number off the document. An existing job is linked; one
      // we do not have raises an approval and waits. Never creates a job.
      try {
        await jobsService.applyToInvoice(invoiceId, f);
      } catch (jobError) {
        console.warn(
          '[invoices] Could not resolve the job number:',
          jobError.message
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

      console.log(
        `[capture] Invoice ${invoiceId} finished processing`
      );

      return;

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

      // The caller has long since been answered. What went wrong is on the
      // invoice's own status and in its processing history, which is where a
      // person looks for it.
      console.error(
        `[capture] Invoice ${invoiceId} could not be read: ${err.message}`
      );

      return;

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
        dateTo,
        withIssues
      } = req.query;

      // The exceptions screen groups invoices by what is actually wrong with
      // them, so it asks for the top failing validation rule alongside each
      // row. The ordinary list does not pay for those lookups.
      const issueColumns =
        String(withIssues) === '1'
          ? `,
            (
              SELECT v.message
              FROM invoice_validation_results v
              WHERE v.invoice_id = i.id
                AND v.passed = 0
              ORDER BY
                CASE v.severity
                  WHEN 'error' THEN 0
                  WHEN 'warning' THEN 1
                  ELSE 2
                END,
                v.id
              LIMIT 1
            ) AS issue_message,
            (
              SELECT v.rule_code
              FROM invoice_validation_results v
              WHERE v.invoice_id = i.id
                AND v.passed = 0
              ORDER BY
                CASE v.severity
                  WHEN 'error' THEN 0
                  WHEN 'warning' THEN 1
                  ELSE 2
                END,
                v.id
              LIMIT 1
            ) AS issue_rule,
            (
              SELECT v.severity
              FROM invoice_validation_results v
              WHERE v.invoice_id = i.id
                AND v.passed = 0
              ORDER BY
                CASE v.severity
                  WHEN 'error' THEN 0
                  WHEN 'warning' THEN 1
                  ELSE 2
                END,
                v.id
              LIMIT 1
            ) AS issue_severity`
          : '';

      let sql =
        `
          SELECT i.*${issueColumns}
          FROM invoices i
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
          ` AND i.status = $${params.length}`;

      }

      // ----------------------------------------------------------------------
      // DATE FROM
      // ----------------------------------------------------------------------

      if (dateFrom) {

        params.push(dateFrom);

        sql +=
          ` AND DATE(i.invoice_date) >= DATE($${params.length})`;

      }

      // ----------------------------------------------------------------------
      // DATE TO
      // ----------------------------------------------------------------------

      if (dateTo) {

        params.push(dateTo);

        sql +=
          ` AND DATE(i.invoice_date) <= DATE($${params.length})`;

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
            i.invoice_number ILIKE ${p}
            OR i.supplier_name ILIKE ${p}
            OR i.supplier_vat_number ILIKE ${p}
            OR i.purchase_order_number ILIKE ${p}
            OR i.account_code ILIKE ${p}
            OR CAST(i.total_amount AS TEXT) ILIKE ${p}
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
          ORDER BY i.updated_at DESC NULLS LAST
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
        path.isAbsolute(doc.file_path)
          ? doc.file_path
          : path.join(
              __dirname,
              '..',
              doc.file_path
            );

      // Disk first, then the database. After a restart the disk is empty and
      // the database is the only copy — which is the whole point of keeping
      // one there.
      const found =
        await documentStore.read(
          'invoice_documents',
          doc.id,
          absolutePath
        );

      if (!found) {

        return res.status(404).json({
          error:
            'The original document for this invoice is no longer stored'
        });

      }

      if (doc.mime_type) {
        res.type(doc.mime_type);
      }

      return res.send(found.buffer);

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

  'account_code',

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

      }

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

// DELETE API ROUTE
// ADD THIS TO routes/invoices.js
// ===========================================================================

// ----------------------------------------------------------------------------
// DELETE HELPER
//
// Removes an invoice, everything hanging off it, and the scanned document on
// disk. Child rows are deleted explicitly rather than relying on the schema's
// ON DELETE CASCADE so the behaviour is identical on a database created before
// those constraints existed.
// ----------------------------------------------------------------------------

async function deleteInvoiceById(invoiceId) {

  const invoice =
    await db.get(
      `
        SELECT id
        FROM invoices
        WHERE id = $1
      `,
      [invoiceId]
    );

  if (!invoice) {
    return false;
  }

  // Collect the document paths before the rows disappear.
  const documents =
    await db.all(
      `
        SELECT file_path
        FROM invoice_documents
        WHERE invoice_id = $1
      `,
      [invoiceId]
    );

  await db.run(
    `
      DELETE FROM invoice_validation_results
      WHERE invoice_id = $1
    `,
    [invoiceId]
  );

  await db.run(
    `
      DELETE FROM invoice_line_items
      WHERE invoice_id = $1
    `,
    [invoiceId]
  );

  await db.run(
    `
      DELETE FROM invoice_processing_logs
      WHERE invoice_id = $1
    `,
    [invoiceId]
  );

  await db.run(
    `
      DELETE FROM invoice_documents
      WHERE invoice_id = $1
    `,
    [invoiceId]
  );

  await db.run(
    `
      DELETE FROM goods_received_notes
      WHERE invoice_id = $1
    `,
    [invoiceId]
  );

  await db.run(
    `
      DELETE FROM invoices
      WHERE id = $1
    `,
    [invoiceId]
  );

  // The database record is gone either way — a leftover file is not worth
  // failing the request over, so cleanup errors are logged, not thrown.
  for (const doc of documents) {

    if (!doc.file_path) {
      continue;
    }

    try {

      const absolute =
        path.isAbsolute(doc.file_path)
          ? doc.file_path
          : path.join(
              __dirname,
              '..',
              doc.file_path
            );

      // Never delete outside the uploads directory.
      if (
        absolute.startsWith(UPLOAD_DIR) &&
        fs.existsSync(absolute)
      ) {
        fs.unlinkSync(absolute);
      }

    } catch (fileError) {

      console.warn(
        '[invoices/delete] Could not remove document file:',
        fileError.message
      );

    }

  }

  return true;

}

// ============================================================================
// DELETE /api/invoices/:id
// ============================================================================

router.delete(
  '/:id',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  async (req, res) => {

    try {

      const deleted =
        await deleteInvoiceById(
          req.params.id
        );

      if (!deleted) {

        return res.status(404).json({
          error:
            'Invoice not found'
        });

      }

      console.log(
        `[invoices/delete] Invoice ${req.params.id} deleted by ${req.user.id}`
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

// ============================================================================
// POST /api/invoices/bulk-delete
//
// Deleting a multi-select from the invoices table in one request instead of
// one request per row.
// ============================================================================

router.post(
  '/bulk-delete',
  requireAuth,
  requireRole(
    'admin',
    'reviewer'
  ),
  async (req, res) => {

    try {

      const ids =
        Array.isArray(req.body?.ids)
          ? req.body.ids
              .filter(
                (id) =>
                  typeof id === 'string' &&
                  id.trim()
              )
              .map((id) => id.trim())
          : [];

      if (!ids.length) {

        return res.status(400).json({
          error:
            'No invoices were selected for deletion'
        });

      }

      if (ids.length > 200) {

        return res.status(400).json({
          error:
            'Too many invoices selected — delete at most 200 at a time'
        });

      }

      const deleted = [];
      const failed = [];

      for (const id of ids) {

        try {

          const ok =
            await deleteInvoiceById(id);

          if (ok) {
            deleted.push(id);
          } else {
            failed.push(id);
          }

        } catch (error) {

          console.error(
            `[invoices/bulk-delete] ${id}:`,
            error
          );

          failed.push(id);

        }

      }

      console.log(
        `[invoices/bulk-delete] ${deleted.length} deleted, ` +
        `${failed.length} failed, by ${req.user.id}`
      );

      return res.json({
        success: true,
        deleted,
        failed,
        deleted_count: deleted.length
      });

    } catch (error) {

      console.error(
        '[invoices/bulk-delete]',
        error
      );

      return res.status(500).json({
        error:
          `Unable to delete invoices: ${error.message}`
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

      // ----------------------------------------------------------------------
      // STOCK
      //
      // Approval is the point at which an invoice becomes a receipt of goods,
      // so this is where stock moves. Confident line matches post to the
      // ledger; anything uncertain goes to the stock review queue rather than
      // being guessed. A failure here must not undo the approval, so it is
      // recorded and surfaced rather than thrown.
      // ----------------------------------------------------------------------

      let stockResult = null;

      try {

        stockResult =
          await postInvoiceToStock(
            req.params.id,
            req.user.id
          );

        await log(
          req.params.id,
          'stock_posted',
          req.user.id,
          {
            posted: stockResult.posted,
            posted_count: stockResult.posted_count || 0,
            queued_count: stockResult.queued_count || 0,
            skipped_count: stockResult.skipped_count || 0,
            reason: stockResult.reason || null
          }
        );

      } catch (stockError) {

        console.error(
          '[invoices/approve] Stock posting failed:',
          stockError
        );

        stockResult = {
          posted: false,
          error: stockError.message
        };

        await log(
          req.params.id,
          'error',
          req.user.id,
          {
            message: `Stock posting failed: ${stockError.message}`
          }
        );
      }

      return res.json({

        invoice:
          await getInvoiceFull(
            req.params.id
          ),

        stock: stockResult

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
            account_code = $10,

            subtotal = $11,
            vat_amount = $12,
            total_amount = $13,

            currency = $14,
            payment_terms = $15,

            status = $16,
            overall_confidence = $17,
            field_confidence = $18,

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

          f.account_code || null,

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
              total,
              supplier_product_code,
              unit_of_measure
            )
            VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [

            uuid(),

            req.params.id,

            li.description || null,

            li.quantity ?? null,

            li.unit_price ?? null,

            li.vat ?? null,

            li.total ?? null,

            li.supplier_product_code || null,

            li.unit_of_measure || null

          ]
        );

      }

      // Re-reading a document re-reads its stock lines with it. Decisions a
      // person has already made are left alone.
      try {
        await invoiceStock.evaluateInvoiceLines(req.params.id);

        await jobsService.applyToInvoice(req.params.id, f);
      } catch (stockError) {
        console.warn(
          '[invoices] Could not evaluate stock lines:',
          stockError.message
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

      const retryDocumentId = uuid();

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

          retryDocumentId,

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

      await documentStore.keep(
        'invoice_documents',
        retryDocumentId,
        req.file.path
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

// ============================================================================
// GET /api/invoices/:id/stock
//
// What posting this invoice would do to stock, line by line, before it is
// posted. Projections only.
// ============================================================================

router.get(
  '/:id/stock',
  requireAuth,
  async (req, res) => {
    try {

      const plan =
        await invoiceStock.invoiceStockPlan(req.params.id);

      if (!plan) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      return res.json(plan);

    } catch (error) {
      console.error('[invoices/stock]', error);

      return res.status(500).json({
        error: `Unable to work out the stock impact: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/invoices/:id/stock/evaluate
//
// Re-reads the lines against the Product Master. Creates nothing, moves
// nothing, and leaves decisions a person has made alone.
// ============================================================================

router.post(
  '/:id/stock/evaluate',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const result =
        await invoiceStock.evaluateInvoiceLines(req.params.id);

      if (!result.evaluated) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      return res.json({
        ...result,
        plan: await invoiceStock.invoiceStockPlan(req.params.id),
      });

    } catch (error) {
      console.error('[invoices/stock/evaluate]', error);

      return res.status(500).json({
        error: `Unable to match the invoice lines: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// PATCH /api/invoices/:id/lines/:lineId/stock
//
// The decision a person makes about one line: match it to a product, or keep
// it off the books. Reversible until the invoice is posted.
// ============================================================================

router.patch(
  '/:id/lines/:lineId/stock',
  requireAuth,
  requireRole('admin', 'reviewer', 'processor'),
  async (req, res) => {
    try {

      const result =
        await invoiceStock.setLineDecision(
          req.params.id,
          req.params.lineId,
          req.body || {},
          req.user.id
        );

      if (!result.updated) {
        const status =
          result.reason === 'line_not_found'
            ? 404
            : result.reason === 'already_posted'
              ? 409
              : 400;

        const messages = {
          line_not_found: 'That invoice line does not exist',
          already_posted:
            'This line has already been posted to stock and cannot be changed',
          product_required: 'Choose the product this line refers to',
          product_not_found: 'That product does not exist',
          unknown_decision: 'That is not a decision this line can take',
        };

        return res.status(status).json({
          error: messages[result.reason] || 'Unable to record that decision',
          reason: result.reason,
        });
      }

      await log(
        req.params.id,
        'stock_decision',
        req.user.id,
        `${result.decision} for line ${req.params.lineId}`
      );

      return res.json({
        ...result,
        plan: await invoiceStock.invoiceStockPlan(req.params.id),
      });

    } catch (error) {
      console.error('[invoices/lines/stock]', error);

      return res.status(500).json({
        error: `Unable to record that decision: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/invoices/:id/lines/:lineId/product
//
// Adds an invoice line to the Product Master as a new product. The only path
// in the application by which an invoice can create one, and it exists so
// that doing so is always a deliberate act.
// ============================================================================

router.post(
  '/:id/lines/:lineId/product',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
        return res.status(400).json({
          error:
            'Creating a product from an invoice line has to be confirmed explicitly',
        });
      }

      const result =
        await invoiceStock.createProductForLine(
          req.params.id,
          req.params.lineId,
          req.body || {},
          req.user.id
        );

      if (!result.created) {
        const status =
          result.reason === 'line_not_found'
            ? 404
            : result.reason === 'already_posted'
              ? 409
              : 400;

        const messages = {
          line_not_found: 'That invoice line does not exist',
          already_posted:
            'This line has already been posted to stock and cannot be changed',
          description_required: 'A product description is required',
        };

        return res.status(status).json({
          error: messages[result.reason] || 'Unable to create that product',
          reason: result.reason,
        });
      }

      await log(
        req.params.id,
        'product_created',
        req.user.id,
        `${result.product.description} from line ${req.params.lineId}`
      );

      return res.status(201).json({
        ...result,
        plan: await invoiceStock.invoiceStockPlan(req.params.id),
      });

    } catch (error) {
      console.error('[invoices/lines/product]', error);

      return res.status(500).json({
        error: `Unable to create that product: ${error.message}`,
      });
    }
  }
);


module.exports = {
  router,
  getInvoiceFull
};
