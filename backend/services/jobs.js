// ============================================================================
// JOBS
// ============================================================================
//
// A job number is the thread tying an invoice and a stock issue to the same
// piece of work. This module owns three things:
//
//   1. Reading a job number off a document without guessing.
//   2. Deciding whether that number is one we already know.
//   3. Never creating a job because of either of the above.
//
// That last point is the whole design. Detection produces a question, not a
// record. A job exists only because a person answered yes.
// ============================================================================

const { v4: uuid } = require('uuid');

const db = require('../db');

const SOURCE_TYPES = {
  INVOICE: 'INVOICE',
  STOCK_SHEET: 'STOCK_SHEET',
};

// What resolveJob can conclude.
const RESOLUTION = {
  // Nothing usable was written down.
  NO_JOB: 'NO_JOB',

  // This is a job we already have.
  EXISTING: 'EXISTING',

  // A real-looking number that matches nothing. A person has to decide.
  NEW_JOB_REQUIRES_APPROVAL: 'NEW_JOB_REQUIRES_APPROVAL',
};

// What a person can do with a number they refused to create.
const REJECT_ACTIONS = {
  ASSIGN_EXISTING: 'ASSIGN_EXISTING',
  UNASSIGNED: 'UNASSIGNED',
};

// ---------------------------------------------------------------------------
// READING A NUMBER
// ---------------------------------------------------------------------------

/**
 * Normalises a job number for comparison.
 *
 * Deliberately narrow. Only one difference is collapsed: the separator between
 * a letter prefix and a trailing number, so JOB-1001, JOB 1001 and JOB1001 are
 * one job. Anything more — dropping a suffix, ignoring a middle segment,
 * fuzzy-matching digits — risks merging two jobs that a store keeps apart, and
 * merging jobs is not something a person can easily undo.
 *
 * @param {string} raw
 * @returns {{number: string, key: string}|null} null when nothing usable
 */
function normalizeJobNumber(raw) {
  if (raw === null || raw === undefined) return null;

  const text = String(raw).trim();

  if (!text) return null;

  // One line, one space between words, upper case.
  const tidy = text.replace(/\s+/g, ' ').trim().toUpperCase();

  // A job number has to carry a number. A bare word is a label, not an id.
  if (!/[0-9]/.test(tidy)) return null;

  if (tidy.length < 2 || tidy.length > 40) return null;

  // Obvious non-answers written into a job field.
  if (/^(N\/?A|NONE|NIL|TBC|TBA|UNKNOWN|-+)$/i.test(tidy)) return null;

  // LETTERS then separator then DIGITS — the one shape we collapse.
  const parts = tidy.match(/^([A-Z]+)[\s\-_/]*([0-9]+)$/);

  const key =
    parts
      ? `${parts[1]}${parts[2]}`
      : tidy.replace(/\s+/g, ' ');

  return { number: tidy, key };
}

// The invoice fields a job number is written into, in the order worth trusting.
const INVOICE_JOB_FIELDS = [
  'job_number',
  'job_reference',
  'customer_reference',
  'reference',
  'purchase_order_number',
];

/**
 * Picks a job number out of an invoice's captured fields.
 *
 * Reads the fields a job is actually written into and stops at the first that
 * yields a usable number. Nothing is inferred from free text: a number that is
 * not in one of these fields is not a job number as far as this is concerned,
 * and the invoice goes to a person instead.
 *
 * @param {object} source - an invoice row or an extraction result
 * @returns {{number: string, key: string, field: string}|null}
 */
function jobNumberFrom(source) {
  if (!source) return null;

  for (const field of INVOICE_JOB_FIELDS) {
    const normalized = normalizeJobNumber(source[field]);

    if (normalized) {
      return { ...normalized, field };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// RESOLVING
// ---------------------------------------------------------------------------

/**
 * Looks a job number up. Creates nothing, ever.
 *
 * This is the single place that answers "do we have this job?", so both the
 * invoice path and the stock path get the same answer to the same question.
 *
 * @param {string} rawJobNumber
 * @returns {Promise<{status: string, job?: object, job_number?: string}>}
 */
async function resolveJob(rawJobNumber) {
  const normalized = normalizeJobNumber(rawJobNumber);

  if (!normalized) {
    return { status: RESOLUTION.NO_JOB };
  }

  const job =
    await db.get(
      'SELECT * FROM jobs WHERE normalized_key = $1',
      [normalized.key]
    );

  if (job) {
    return { status: RESOLUTION.EXISTING, job, job_number: normalized.number };
  }

  return {
    status: RESOLUTION.NEW_JOB_REQUIRES_APPROVAL,
    job_number: normalized.number,
    normalized_key: normalized.key,
  };
}

/**
 * Records that a document named a job we do not have.
 *
 * Idempotent per source line: reading the same document twice asks once.
 *
 * @returns {Promise<object|null>} the pending approval
 */
async function requestApproval({
  jobNumber,
  sourceType,
  sourceId,
  sourceLineId = null,
}) {
  const normalized = normalizeJobNumber(jobNumber);

  if (!normalized) return null;

  // Somebody may have created it between the read and here.
  const existing =
    await db.get(
      'SELECT * FROM jobs WHERE normalized_key = $1',
      [normalized.key]
    );

  if (existing) return null;

  await db.run(
    `
      INSERT INTO job_approvals (
        id, job_number, normalized_key, source_type, source_id, source_line_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
    `,
    [uuid(), normalized.number, normalized.key, sourceType, sourceId, sourceLineId]
  );

  return db.get(
    `
      SELECT * FROM job_approvals
      WHERE source_type = $1
        AND source_id = $2
        AND COALESCE(source_line_id, '') = COALESCE($3, '')
        AND normalized_key = $4
    `,
    [sourceType, sourceId, sourceLineId, normalized.key]
  );
}

/**
 * Whether anything on this document is still waiting on a person.
 *
 * Used to hold a stock sheet at the gate: stock must not move against a job
 * nobody has agreed to.
 */
async function pendingForSource(sourceType, sourceId) {
  return db.all(
    `
      SELECT * FROM job_approvals
      WHERE source_type = $1 AND source_id = $2 AND status = 'PENDING'
      ORDER BY created_at
    `,
    [sourceType, sourceId]
  );
}

// ---------------------------------------------------------------------------
// ANSWERING
// ---------------------------------------------------------------------------

/**
 * Creates the job a person approved, and attaches what it was found on.
 *
 * The check is made again here rather than trusted from the screen: between
 * the question being asked and answered, somebody else may have created the
 * same job. If they did, that job is used — approving twice must not mean two
 * jobs, and it must not fail either. The unique index is the last word.
 *
 * @returns {Promise<{job: object, created: boolean, attached: object}>}
 */
async function approve(approvalId, userId) {
  const approval =
    await db.get('SELECT * FROM job_approvals WHERE id = $1', [approvalId]);

  if (!approval) {
    return { error: 'not_found' };
  }

  if (approval.status !== 'PENDING') {
    return { error: 'already_answered', approval };
  }

  let job =
    await db.get(
      'SELECT * FROM jobs WHERE normalized_key = $1',
      [approval.normalized_key]
    );

  let created = false;

  if (!job) {
    const id = uuid();

    // ON CONFLICT covers the race the re-check above cannot: two approvals
    // landing between the SELECT and the INSERT.
    await db.run(
      `
        INSERT INTO jobs (
          id, job_number, normalized_key, first_source_type, first_source_id,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (normalized_key) DO NOTHING
      `,
      [
        id,
        approval.job_number,
        approval.normalized_key,
        approval.source_type,
        approval.source_id,
        userId || null,
      ]
    );

    job =
      await db.get(
        'SELECT * FROM jobs WHERE normalized_key = $1',
        [approval.normalized_key]
      );

    created = Boolean(job && job.id === id);
  }

  const attached = await attachSource(approval, job.id);

  await db.run(
    `
      UPDATE job_approvals
      SET status = 'APPROVED',
          resolution = 'CREATED',
          resolved_job_id = $1,
          resolved_by = $2,
          resolved_at = NOW()
      WHERE id = $3
    `,
    [job.id, userId || null, approval.id]
  );

  // "Should this job exist?" is one question, however many lines raised it. A
  // sheet issuing five products to the same new job asks once; answering it
  // settles the rest and attaches them, rather than making a person press the
  // same button five times to clear a sheet.
  const sameNumber =
    await db.all(
      `
        SELECT * FROM job_approvals
        WHERE normalized_key = $1 AND status = 'PENDING' AND id <> $2
      `,
      [approval.normalized_key, approval.id]
    );

  for (const other of sameNumber) {
    await attachSource(other, job.id);

    await db.run(
      `
        UPDATE job_approvals
        SET status = 'APPROVED',
            resolution = 'CREATED',
            resolved_job_id = $1,
            resolved_by = $2,
            resolved_at = NOW()
        WHERE id = $3
      `,
      [job.id, userId || null, other.id]
    );
  }

  return { job, created, attached, also_settled: sameNumber.length };
}

/**
 * Records that a person refused to create the job, and what they chose instead.
 *
 * The document is never touched beyond its job link: an invoice stays
 * captured, a sheet stays reviewable. Only the job creation was refused.
 */
async function reject(approvalId, userId, { action, jobId } = {}) {
  const approval =
    await db.get('SELECT * FROM job_approvals WHERE id = $1', [approvalId]);

  if (!approval) {
    return { error: 'not_found' };
  }

  if (approval.status !== 'PENDING') {
    return { error: 'already_answered', approval };
  }

  let resolvedJobId = null;

  if (action === REJECT_ACTIONS.ASSIGN_EXISTING) {
    const job = await db.get('SELECT * FROM jobs WHERE id = $1', [jobId]);

    if (!job) {
      return { error: 'job_not_found' };
    }

    resolvedJobId = job.id;

    await attachSource(approval, job.id);
  }

  await db.run(
    `
      UPDATE job_approvals
      SET status = 'REJECTED',
          resolution = $1,
          resolved_job_id = $2,
          resolved_by = $3,
          resolved_at = NOW()
      WHERE id = $4
    `,
    [
      resolvedJobId ? 'ASSIGNED_EXISTING' : 'UNASSIGNED',
      resolvedJobId,
      userId || null,
      approval.id,
    ]
  );

  // Refusing a number refuses it everywhere, the way approving it settles it
  // everywhere. Without this, a backfill that met JOB-1045 on thirty invoices
  // would leave twenty-nine copies of a question already answered.
  //
  // Assigning to an existing job is the exception: the person picked that job
  // for this document, and there is no reason to believe every other document
  // carrying the same misread number belongs there too. Those stay open.
  const settleSiblings = !resolvedJobId;

  let alsoSettled = 0;

  if (settleSiblings) {
    const siblings =
      await db.all(
        `
          SELECT * FROM job_approvals
          WHERE normalized_key = $1 AND status = 'PENDING' AND id <> $2
        `,
        [approval.normalized_key, approval.id]
      );

    for (const other of siblings) {
      await db.run(
        `
          UPDATE job_approvals
          SET status = 'REJECTED',
              resolution = 'UNASSIGNED',
              resolved_by = $1,
              resolved_at = NOW()
          WHERE id = $2
        `,
        [userId || null, other.id]
      );
    }

    alsoSettled = siblings.length;
  }

  return {
    rejected: true,
    assigned_job_id: resolvedJobId,
    also_settled: alsoSettled,
    approval: await db.get('SELECT * FROM job_approvals WHERE id = $1', [approval.id]),
  };
}

// ---------------------------------------------------------------------------
// APPLYING TO A DOCUMENT
// ---------------------------------------------------------------------------

/**
 * Reads an invoice's job number and does the one safe thing with it.
 *
 * An existing job is linked immediately — that needs nobody's permission. A
 * number we do not have raises an approval and stops there: the invoice stays
 * captured and unassigned until a person answers. Nothing here creates a job.
 *
 * The number read is stored on the invoice either way, so a screen can show
 * what was on the document even while it belongs to no job.
 *
 * @returns {Promise<{status: string, job?: object, approval?: object}>}
 */
async function applyToInvoice(invoiceId, fields) {
  const invoice =
    await db.get('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  if (!invoice) return { status: RESOLUTION.NO_JOB };

  // A person's assignment is not overwritten by a re-read.
  if (invoice.job_id) {
    return {
      status: RESOLUTION.EXISTING,
      job: await db.get('SELECT * FROM jobs WHERE id = $1', [invoice.job_id]),
    };
  }

  const found = jobNumberFrom({ ...invoice, ...(fields || {}) });

  if (!found) {
    return { status: RESOLUTION.NO_JOB };
  }

  await db.run(
    'UPDATE invoices SET job_reference = $1 WHERE id = $2',
    [found.number, invoiceId]
  );

  const resolution = await resolveJob(found.number);

  if (resolution.status === RESOLUTION.EXISTING) {
    await attachInvoice(invoiceId, resolution.job.id);

    return { status: resolution.status, job: resolution.job, field: found.field };
  }

  const approval =
    await requestApproval({
      jobNumber: found.number,
      sourceType: SOURCE_TYPES.INVOICE,
      sourceId: invoiceId,
    });

  return { status: resolution.status, approval, field: found.field };
}

// ---------------------------------------------------------------------------
// BACKFILL
// ---------------------------------------------------------------------------

/**
 * Reads job numbers off records captured before jobs existed.
 *
 * Same rule as everything else here: a number matching a job we have is
 * linked, and a number matching nothing becomes a question. A backfill of two
 * years of invoices creates no jobs on its own — it just stops the history
 * being invisible.
 *
 * Safe to run twice. Records already linked are skipped, an assignment a
 * person made is never overwritten, and asking the same question again is a
 * no-op.
 *
 * @param {object} options
 * @param {boolean} options.dryRun - count what would happen, change nothing
 * @returns {Promise<object>} what was found, and the numbers still unanswered
 */
async function backfill({ dryRun = false } = {}) {
  const counts = {
    invoices_scanned: 0,
    invoices_linked: 0,
    invoices_pending: 0,
    invoices_no_number: 0,
    movements_scanned: 0,
    movements_linked: 0,
    movements_pending: 0,
    sheet_rows_linked: 0,
  };

  // Job numbers this run met that do not exist yet, and what raised them.
  const unknown = new Map();

  const note = (number, kind, label) => {
    const key = normalizeJobNumber(number)?.key;

    if (!key) return;

    if (!unknown.has(key)) {
      unknown.set(key, { job_number: number, invoices: 0, movements: 0, examples: [] });
    }

    const entry = unknown.get(key);

    entry[kind] += 1;

    if (entry.examples.length < 5 && label) entry.examples.push(label);
  };

  // ---- invoices --------------------------------------------------------

  // Only two of the fields jobNumberFrom knows about are kept on an invoice
  // row: what a previous read stored in job_reference, and the PO. The rest
  // (job_number, customer_reference) live in the extraction result, which is
  // not replayed here — a document already captured is read as it was stored.
  const invoices =
    await db.all(
      `
        SELECT id, invoice_number, job_reference, purchase_order_number
        FROM invoices
        WHERE job_id IS NULL
        ORDER BY created_at
      `
    );

  for (const invoice of invoices) {
    counts.invoices_scanned += 1;

    const found = jobNumberFrom(invoice);

    if (!found) {
      counts.invoices_no_number += 1;

      continue;
    }

    const job =
      await db.get(
        'SELECT * FROM jobs WHERE normalized_key = $1',
        [found.key]
      );

    if (job) {
      counts.invoices_linked += 1;

      if (!dryRun) {
        await db.run(
          'UPDATE invoices SET job_id = $1, job_reference = COALESCE(job_reference, $2) WHERE id = $3',
          [job.id, found.number, invoice.id]
        );
      }

      continue;
    }

    counts.invoices_pending += 1;

    note(found.number, 'invoices', invoice.invoice_number || invoice.id);

    if (!dryRun) {
      await db.run(
        'UPDATE invoices SET job_reference = COALESCE(job_reference, $1) WHERE id = $2',
        [found.number, invoice.id]
      );

      await requestApproval({
        jobNumber: found.number,
        sourceType: SOURCE_TYPES.INVOICE,
        sourceId: invoice.id,
      });
    }
  }

  // ---- stock movements -------------------------------------------------
  //
  // A movement carries the wording written on the sheet. The question, when
  // there is one, belongs to the sheet line it came from, so answering it
  // later attaches the movement through the same path a fresh sheet uses.

  const movements =
    await db.all(
      `
        SELECT t.id, t.job_reference, t.source_document_id, t.source_line_id,
               s.sheet_number
        FROM stock_transactions t
        LEFT JOIN stock_sheets s
          ON s.id = t.source_document_id AND t.source_document_type = 'STOCK_SHEET'
        WHERE t.job_id IS NULL
          AND t.job_reference IS NOT NULL
          AND t.job_reference <> ''
        ORDER BY t.created_at
      `
    );

  for (const movement of movements) {
    counts.movements_scanned += 1;

    const found = normalizeJobNumber(movement.job_reference);

    if (!found) continue;

    const job =
      await db.get('SELECT * FROM jobs WHERE normalized_key = $1', [found.key]);

    if (job) {
      counts.movements_linked += 1;

      if (!dryRun) {
        await db.run(
          'UPDATE stock_transactions SET job_id = $1 WHERE id = $2',
          [job.id, movement.id]
        );

        if (movement.source_line_id) {
          await db.run(
            'UPDATE stock_sheet_rows SET job_id = $1 WHERE id = $2 AND job_id IS NULL',
            [job.id, movement.source_line_id]
          );

          counts.sheet_rows_linked += 1;
        }
      }

      continue;
    }

    counts.movements_pending += 1;

    note(found.number, 'movements', movement.sheet_number || movement.id);

    if (!dryRun && movement.source_document_id) {
      await requestApproval({
        jobNumber: found.number,
        sourceType: SOURCE_TYPES.STOCK_SHEET,
        sourceId: movement.source_document_id,
        sourceLineId: movement.source_line_id || null,
      });
    }
  }

  return {
    dry_run: dryRun,
    counts,
    unknown_jobs:
      [...unknown.values()].sort(
        (a, b) =>
          (b.invoices + b.movements) - (a.invoices + a.movements) ||
          a.job_number.localeCompare(b.job_number)
      ),
  };
}

// ---------------------------------------------------------------------------
// ATTACHING
// ---------------------------------------------------------------------------

/**
 * Points whatever raised an approval at a job.
 *
 * A sheet line is linked on its row; the movement it eventually posts picks
 * the job up from there, so approving before posting and approving after both
 * end in the same place.
 */
async function attachSource(approval, jobId) {
  if (approval.source_type === SOURCE_TYPES.INVOICE) {
    return attachInvoice(approval.source_id, jobId);
  }

  if (approval.source_line_id) {
    await db.run(
      'UPDATE stock_sheet_rows SET job_id = $1 WHERE id = $2',
      [jobId, approval.source_line_id]
    );

    // A movement already posted from this line is relinked too, so approving
    // after the fact is not a dead end.
    await db.run(
      'UPDATE stock_transactions SET job_id = $1 WHERE source_line_id = $2',
      [jobId, approval.source_line_id]
    );

    return { stock_sheet_row: approval.source_line_id };
  }

  await db.run(
    'UPDATE stock_sheets SET job_id = $1 WHERE id = $2',
    [jobId, approval.source_id]
  );

  await db.run(
    `
      UPDATE stock_sheet_rows
      SET job_id = $1
      WHERE sheet_id = $2 AND job_id IS NULL AND raw_job IS NULL
    `,
    [jobId, approval.source_id]
  );

  return { stock_sheet: approval.source_id };
}

async function attachInvoice(invoiceId, jobId) {
  await db.run(
    'UPDATE invoices SET job_id = $1, updated_at = NOW() WHERE id = $2',
    [jobId, invoiceId]
  );

  return { invoice: invoiceId };
}

// ---------------------------------------------------------------------------
// READING JOBS BACK
// ---------------------------------------------------------------------------

/**
 * Every job, with what is hanging off it.
 *
 * The counts are summaries; the detail lives on the job page. Both are read
 * from the invoice and stock tables directly, so a job can never disagree with
 * the records it points at.
 */
async function listJobs({ search = '', limit = 100, offset = 0 } = {}) {
  const params = [];
  let where = '';

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toUpperCase()}%`);
    where = `WHERE UPPER(j.job_number) LIKE $${params.length}`;
  }

  params.push(limit, offset);

  const rows =
    await db.all(
      `
        SELECT
          j.*,
          (SELECT COUNT(*)::int FROM invoices i WHERE i.job_id = j.id)
            AS invoice_count,
          (SELECT COUNT(*)::int FROM stock_transactions t
            WHERE t.job_id = j.id AND t.transaction_type = 'STOCK_ISSUE')
            AS stock_issue_count,
          GREATEST(
            COALESCE((SELECT MAX(i.created_at) FROM invoices i WHERE i.job_id = j.id), j.created_at),
            COALESCE((SELECT MAX(t.created_at) FROM stock_transactions t WHERE t.job_id = j.id), j.created_at)
          ) AS last_activity_at
        FROM jobs j
        ${where}
        ORDER BY last_activity_at DESC, j.job_number
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );

  const total =
    await db.get(
      `SELECT COUNT(*)::int AS n FROM jobs j ${where}`,
      search && String(search).trim() ? [params[0]] : []
    );

  return { jobs: rows, total: total ? total.n : rows.length };
}

/**
 * One job with everything on it.
 *
 * Invoices come back whole — header, totals and every line — and stock issues
 * come back as the movements they are, each still naming the sheet it was
 * signed out on. Nothing here is a copy: change an invoice anywhere in
 * InvoiceFlow and this reads the change.
 */
async function jobDetail(jobId) {
  const job = await db.get('SELECT * FROM jobs WHERE id = $1', [jobId]);

  if (!job) return null;

  const invoices =
    await db.all(
      `
        SELECT
          i.*,
          s.name AS supplier_display_name,
          (SELECT COUNT(*)::int FROM invoice_line_items li WHERE li.invoice_id = i.id)
            AS line_item_count,
          (SELECT COUNT(*)::int FROM invoice_documents d WHERE d.invoice_id = i.id)
            AS document_count
        FROM invoices i
        LEFT JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.job_id = $1
        ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC
      `,
      [jobId]
    );

  const lines =
    invoices.length
      ? await db.all(
          `
            SELECT
              li.*,
              p.sku AS product_sku,
              p.description AS product_name,
              p.bin_location AS product_bin
            FROM invoice_line_items li
            LEFT JOIN products p ON p.id = li.product_id
            WHERE li.invoice_id = ANY($1::text[])
            ORDER BY li.invoice_id, li.id
          `,
          [invoices.map((invoice) => invoice.id)]
        )
      : [];

  for (const invoice of invoices) {
    invoice.line_items = lines.filter((line) => line.invoice_id === invoice.id);
  }

  const stockIssues =
    await db.all(
      `
        SELECT
          t.*,
          p.sku AS product_sku,
          p.description AS product_description,
          p.bin_location AS product_bin,
          l.code AS location_code,
          l.name AS location_name,
          u.name AS created_by_name,
          sh.id AS sheet_id,
          sh.sheet_number,
          sh.filename AS sheet_filename,
          sh.employee_name AS sheet_employee_name
        FROM stock_transactions t
        LEFT JOIN products p ON p.id = t.product_id
        LEFT JOIN stock_locations l ON l.id = t.location_id
        LEFT JOIN users u ON u.id = t.created_by
        LEFT JOIN stock_sheets sh
          ON sh.id = t.source_document_id AND t.source_document_type = 'STOCK_SHEET'
        WHERE t.job_id = $1 AND t.transaction_type = 'STOCK_ISSUE'
        ORDER BY t.created_at DESC
      `,
      [jobId]
    );

  return {
    job,
    invoices,
    stock_issues: stockIssues,
    summary: {
      invoice_count: invoices.length,
      stock_issue_count: stockIssues.length,
      invoice_total:
        invoices.reduce(
          (sum, invoice) => sum + Number(invoice.total_amount || 0),
          0
        ),
      stock_quantity:
        stockIssues.reduce((sum, issue) => sum + Number(issue.quantity || 0), 0),
    },
    activity: buildActivity(invoices, stockIssues),
  };
}

/**
 * When things arrived on the job, newest first. Real record dates, not a
 * separate log that could drift from them.
 */
function buildActivity(invoices, stockIssues) {
  const entries = [];

  for (const invoice of invoices) {
    entries.push({
      at: invoice.created_at,
      type: 'INVOICE',
      id: invoice.id,
      label: `Invoice ${invoice.invoice_number || invoice.id} added`,
      detail: invoice.supplier_name || invoice.supplier_display_name || null,
      amount: invoice.total_amount,
    });
  }

  for (const issue of stockIssues) {
    entries.push({
      at: issue.created_at,
      type: 'STOCK_ISSUE',
      id: issue.id,
      label: `Stock issue: ${issue.product_description || issue.product_sku || 'product'} × ${Number(issue.quantity)}`,
      detail: issue.sheet_number ? `Sheet ${issue.sheet_number}` : null,
      amount: null,
    });
  }

  return entries.sort((a, b) => new Date(b.at) - new Date(a.at));
}

module.exports = {
  SOURCE_TYPES,
  RESOLUTION,
  REJECT_ACTIONS,
  INVOICE_JOB_FIELDS,
  normalizeJobNumber,
  jobNumberFrom,
  applyToInvoice,
  backfill,
  resolveJob,
  requestApproval,
  pendingForSource,
  approve,
  reject,
  attachInvoice,
  listJobs,
  jobDetail,
};
