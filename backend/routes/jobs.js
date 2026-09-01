// ============================================================================
// InvoiceFlow — Job Routes
// ============================================================================
//
// A job is a number and the records that point at it. These routes read those
// records back and carry the one decision the module needs from a person:
// whether a job number found on a document should become a job at all.
//
// No route here creates a job as a side effect. The only one that writes a job
// row is /approvals/:id/approve, and it runs because somebody pressed a button.
// ============================================================================

const express = require('express');

const db = require('../db');

const {
  requireAuth,
  requireRole,
} = require('../middleware/auth');

const jobs = require('../services/jobs');

const router = express.Router();

// ============================================================================
// GET /api/jobs
//
// Every job, with how much is hanging off each and when it last saw movement.
// ============================================================================

router.get(
  '/',
  requireAuth,
  async (req, res) => {
    try {

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const result =
        await jobs.listJobs({
          search: req.query.q || '',
          limit,
          offset,
        });

      return res.json({
        jobs: result.jobs,
        total: result.total,
        limit,
        offset,
      });

    } catch (error) {
      console.error('[jobs/list]', error);

      return res.status(500).json({
        error: `Unable to load jobs: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/jobs/approvals
//
// Job numbers found on documents that nobody has answered yet. Listed before
// /:id so "approvals" is never read as a job id.
// ============================================================================

router.get(
  '/approvals',
  requireAuth,
  async (req, res) => {
    try {

      const status = String(req.query.status || 'PENDING').toUpperCase();

      const rows =
        await db.all(
          `
            SELECT
              a.*,
              i.invoice_number,
              i.supplier_name,
              i.total_amount,
              sh.sheet_number,
              sh.employee_name AS sheet_employee_name,
              r.raw_description AS row_description,
              r.raw_bin AS row_bin,
              r.quantity AS row_quantity,
              p.description AS row_product_description,
              p.sku AS row_product_sku,
              u.name AS resolved_by_name
            FROM job_approvals a
            LEFT JOIN invoices i
              ON i.id = a.source_id AND a.source_type = 'INVOICE'
            LEFT JOIN stock_sheets sh
              ON sh.id = a.source_id AND a.source_type = 'STOCK_SHEET'
            LEFT JOIN stock_sheet_rows r ON r.id = a.source_line_id
            LEFT JOIN products p ON p.id = r.product_id
            LEFT JOIN users u ON u.id = a.resolved_by
            WHERE ($1 = 'ALL' OR a.status = $1)
            ORDER BY a.created_at DESC
            LIMIT 200
          `,
          [status]
        );

      return res.json({ approvals: rows });

    } catch (error) {
      console.error('[jobs/approvals]', error);

      return res.status(500).json({
        error: `Unable to load job approvals: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/jobs/approvals/:id/approve
//
// The only route that creates a job.
// ============================================================================

router.post(
  '/approvals/:id/approve',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const result = await jobs.approve(req.params.id, req.user.id);

      if (result.error === 'not_found') {
        return res.status(404).json({ error: 'That job approval no longer exists' });
      }

      if (result.error === 'already_answered') {
        return res.status(409).json({
          error: `This was already ${result.approval.status.toLowerCase()}`,
          approval: result.approval,
        });
      }

      return res.json({
        approved: true,
        job: result.job,

        // False means somebody else got there first and the existing job was
        // used. Worth saying so rather than implying two jobs now exist.
        created: result.created,

        attached: result.attached,

        // Other records that named the same number and were settled with it.
        also_settled: result.also_settled || 0,
      });

    } catch (error) {
      console.error('[jobs/approve]', error);

      return res.status(500).json({
        error: `Unable to create the job: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/jobs/approvals/:id/reject
//
// The job is not created. The document is untouched beyond its job link: the
// person either points it at a job that already exists, or leaves it
// unassigned.
// ============================================================================

router.post(
  '/approvals/:id/reject',
  requireAuth,
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {

      const action =
        req.body?.job_id
          ? jobs.REJECT_ACTIONS.ASSIGN_EXISTING
          : jobs.REJECT_ACTIONS.UNASSIGNED;

      const result =
        await jobs.reject(req.params.id, req.user.id, {
          action,
          jobId: req.body?.job_id,
        });

      if (result.error === 'not_found') {
        return res.status(404).json({ error: 'That job approval no longer exists' });
      }

      if (result.error === 'job_not_found') {
        return res.status(400).json({ error: 'That job does not exist' });
      }

      if (result.error === 'already_answered') {
        return res.status(409).json({
          error: `This was already ${result.approval.status.toLowerCase()}`,
          approval: result.approval,
        });
      }

      return res.json(result);

    } catch (error) {
      console.error('[jobs/reject]', error);

      return res.status(500).json({
        error: `Unable to record that decision: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/jobs/resolve
//
// What would happen to this job number? Used by the screens that let a person
// type one in: an existing job attaches straight away, a new one has to be
// approved like any other.
// ============================================================================

router.post(
  '/resolve',
  requireAuth,
  async (req, res) => {
    try {

      const resolution = await jobs.resolveJob(req.body?.job_number);

      if (resolution.status === jobs.RESOLUTION.NO_JOB) {
        return res.status(400).json({
          error: 'That is not a job number I can use',
          status: resolution.status,
        });
      }

      const sourceType = req.body?.source_type;
      const sourceId = req.body?.source_id;

      // Typed in against a document: attach it, or raise the same approval a
      // detected number would have raised.
      if (sourceType && sourceId) {

        // Record the number on the invoice whatever comes of it, so a screen
        // can show what was written down even while it belongs to no job.
        if (sourceType === jobs.SOURCE_TYPES.INVOICE) {
          await db.run(
            'UPDATE invoices SET job_reference = $1 WHERE id = $2',
            [resolution.job_number || resolution.job?.job_number || null, sourceId]
          );
        }

        if (resolution.status === jobs.RESOLUTION.EXISTING) {

          if (sourceType === jobs.SOURCE_TYPES.INVOICE) {
            await jobs.attachInvoice(sourceId, resolution.job.id);
          } else if (req.body?.source_line_id) {
            await db.run(
              'UPDATE stock_sheet_rows SET job_id = $1 WHERE id = $2',
              [resolution.job.id, req.body.source_line_id]
            );
          } else {
            await db.run(
              'UPDATE stock_sheets SET job_id = $1 WHERE id = $2',
              [resolution.job.id, sourceId]
            );
          }

          return res.json({ status: resolution.status, job: resolution.job });
        }

        const approval =
          await jobs.requestApproval({
            jobNumber: resolution.job_number,
            sourceType,
            sourceId,
            sourceLineId: req.body?.source_line_id || null,
          });

        return res.json({ status: resolution.status, approval });
      }

      return res.json(resolution);

    } catch (error) {
      console.error('[jobs/resolve]', error);

      return res.status(500).json({
        error: `Unable to look that job number up: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// POST /api/jobs/backfill
//
// Reads job numbers off records captured before jobs existed. Links what
// matches a job we have; everything else becomes a question. Creates no jobs.
//
// Send { preview: true } to be told what it would find without changing
// anything. Safe to run twice either way.
// ============================================================================

router.post(
  '/backfill',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {

      const result = await jobs.backfill({ dryRun: Boolean(req.body?.preview) });

      return res.json(result);

    } catch (error) {
      console.error('[jobs/backfill]', error);

      return res.status(500).json({
        error: `Unable to read the existing records: ${error.message}`,
      });
    }
  }
);

// ============================================================================
// GET /api/jobs/:id
//
// One job: every invoice on it in full, every stock issue in full, and when
// each arrived. All of it read from the invoice and stock tables, so it cannot
// drift from what those records say.
// ============================================================================

router.get(
  '/:id',
  requireAuth,
  async (req, res) => {
    try {

      const detail = await jobs.jobDetail(req.params.id);

      if (!detail) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.json(detail);

    } catch (error) {
      console.error('[jobs/detail]', error);

      return res.status(500).json({
        error: `Unable to load the job: ${error.message}`,
      });
    }
  }
);

module.exports = router;
