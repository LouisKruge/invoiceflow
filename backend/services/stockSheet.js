// services/stockSheet.js
//
// Turns a physical stock sign-out sheet into a validated stock issue.
//
//   DOCUMENT → AI EXTRACTION → PRODUCT MATCH → VALIDATION → APPROVAL
//            → STOCK ISSUE → LEDGER → CURRENT STOCK
//
// Extraction and posting are deliberately separate stages. Reading a document
// never moves stock; only an approval does. A sheet that is half-read, or that
// contains one line nobody could identify, deducts nothing at all — a partially
// posted sign-out sheet is worse than an unposted one, because the paper record
// and the system then disagree in a way nobody notices.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const { v4: uuid } = require('uuid');

const db = require('../db');

const ledger = require('./stockLedger');
const matching = require('./productMatching');
const importer = require('./stockImport');
const ai = require('./aiExtraction');

const DOCUMENT_TYPE = 'STOCK_SHEET';

// Confidence bands. A score at or above ACCEPT is taken automatically; below
// MANDATORY_REVIEW a person must decide. These are thresholds on top of the
// hard validation rules, never a substitute for them.
const ACCEPT_THRESHOLD = (() => {
  const raw = Number(process.env.STOCK_SHEET_ACCEPT_THRESHOLD);

  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.95;
})();

const MANDATORY_REVIEW_THRESHOLD = (() => {
  const raw = Number(process.env.STOCK_SHEET_REVIEW_THRESHOLD);

  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.8;
})();

// ---------------------------------------------------------------------------
// EXTRACTION PROMPT
// ---------------------------------------------------------------------------

const SHEET_PROMPT = `
You are reading a STOCK SIGN-OUT SHEET from a workshop or warehouse.

The sheet records items taken OUT of stock by an employee, usually for a job.
It may be printed, handwritten, or a mixture of both. Layouts vary widely.

Return ONLY valid JSON with exactly this structure:

{
  "employee": string|null,
  "job": string|null,
  "department": string|null,
  "vehicle": string|null,
  "date": string|null,
  "notes": string|null,
  "rows": [
    {
      "product_code": string|null,
      "description": string|null,
      "bin": string|null,
      "quantity": number|null,
      "raw_quantity": string|null,
      "unit": string|null,
      "notes": string|null,
      "quantity_confidence": number,
      "confidence": number
    }
  ],
  "confidence": {
    "employee": number,
    "job": number,
    "department": number,
    "vehicle": number,
    "date": number
  }
}

RULES:

1. Return one row per item issued. Ignore headers, totals and signature lines.
2. Never invent a row, a product or a quantity.
3. quantity must be a plain number. Write words as digits: "two" is 2,
   "a dozen" is 12, "half" is 0.5.
4. Put whatever the document literally shows for the quantity into
   raw_quantity, even when you have normalized it into quantity.
5. If a quantity is crossed out and rewritten, use the final value.
6. If a handwritten quantity is genuinely ambiguous — "2/?" , a smudge, two
   digits that could each be read two ways — set quantity to null, put what
   you see in raw_quantity, and set quantity_confidence below 0.5. Do NOT
   guess a number you are not confident about.
7. quantity_confidence reflects only how clearly you could read the number.
   confidence reflects how clearly you could read the product identity.
8. Both confidences are between 0.0 and 1.0.
9. Copy product codes exactly as printed, including punctuation.
10. Put the full item wording into description, even when a code is present.
11. Many stores write only the BIN NUMBER for an item — a short location code
    like "A12", "B-04-2" or "R3/S2", often under a column headed Bin,
    Location, Shelf, Rack or Slot. Put it in bin, exactly as written. A row
    with nothing but a bin and a quantity is a real row: return it, with
    description and product_code null.
12. Dates should be YYYY-MM-DD where the year is legible.
13. The employee is the person taking the stock, not a supplier or a manager
    signature, when the two can be distinguished.
14. A job may appear as a job number, a work order, a registration or a
    customer name. Put it in job.
15. If a field is not on the sheet, return null. Do not infer it.
16. Return ONLY the JSON object.
`;

// ---------------------------------------------------------------------------
// QUANTITY NORMALIZATION
// ---------------------------------------------------------------------------

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  dozen: 12, half: 0.5, quarter: 0.25, none: 0, nil: 0,
};

/**
 * Reads a quantity from whatever the sheet actually said.
 *
 * Returns null rather than a guess when the text is ambiguous — an unreadable
 * quantity must reach a human, not the ledger.
 *
 * @returns {{value: number|null, confidence: number, reason: string|null}}
 */
function parseQuantity(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: null, confidence: 0, reason: 'no_quantity' };
  }

  const text = String(raw).trim().toLowerCase();

  // An explicit uncertainty mark from the reader or the writer.
  if (/[?]|illegible|unclear|unreadable/.test(text)) {
    return { value: null, confidence: 0.2, reason: 'ambiguous_quantity' };
  }

  const numeric = importer.toNumber(text);

  if (numeric !== null) {
    // "2 or 3" is not a quantity even though a number can be pulled from it.
    if (/\bor\b|\/|,\s*\d|\bto\b/.test(text) && !/^[\d\s.,]+$/.test(text)) {
      return { value: null, confidence: 0.3, reason: 'ambiguous_quantity' };
    }

    return { value: numeric, confidence: 1, reason: null };
  }

  // Words: "two", "a dozen", "twenty five".
  const words = text.replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);

  let total = 0;
  let matched = 0;
  let fraction = null;

  for (const word of words) {
    if (word === 'a' || word === 'an' || word === 'of') continue;

    if (Object.prototype.hasOwnProperty.call(WORD_NUMBERS, word)) {
      const value = WORD_NUMBERS[word];

      matched += 1;

      // "half a dozen" scales what comes next instead of adding to it.
      if (value === 0.5 || value === 0.25) {
        fraction = fraction === null ? value : fraction * value;
        continue;
      }

      const scaled = fraction === null ? value : value * fraction;

      fraction = null;

      // "one hundred" multiplies rather than adds.
      total = value === 100 && total > 0 ? total * value : total + scaled;
    }
  }

  // A trailing "half" with nothing to scale is just a half.
  if (fraction !== null) total += fraction;

  if (matched > 0 && total > 0) {
    return { value: total, confidence: 0.85, reason: null };
  }

  return { value: null, confidence: 0, reason: 'unreadable_quantity' };
}

// ---------------------------------------------------------------------------
// SHEET NUMBER
// ---------------------------------------------------------------------------

async function nextSheetNumber(client) {
  const runner = client || db;

  const row =
    await runner.query(
      `
        SELECT sheet_number
        FROM stock_sheets
        WHERE sheet_number ~ '^SI-[0-9]+$'
        ORDER BY (regexp_replace(sheet_number, '[^0-9]', '', 'g'))::bigint DESC
        LIMIT 1
      `
    );

  const last =
    row.rows.length
      ? Number(String(row.rows[0].sheet_number).replace(/\D/g, ''))
      : 0;

  return `SI-${String(last + 1).padStart(6, '0')}`;
}

function fileHash(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// EXTRACTION
// ---------------------------------------------------------------------------

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv'];

function isSpreadsheet(filePath, mimeType) {
  const extension = path.extname(filePath || '').toLowerCase();

  return (
    SPREADSHEET_EXTENSIONS.includes(extension) ||
    String(mimeType || '').includes('spreadsheet') ||
    String(mimeType || '').includes('csv') ||
    String(mimeType || '').includes('excel')
  );
}

// A spreadsheet sign-out sheet is a table already, so it is read with the
// existing parser rather than sent to a vision model. Cheaper, faster and
// exact — the AI path is for paper.
//
// The shape differs from a stock list, though: the employee, job and date are
// usually written above the line table rather than beside every line. So the
// whole grid is read, the line table is located inside it, and everything
// above it is treated as the sheet's header block.

const HEADER_LABELS = [
  ['employee',   /^(employee|employeename|issuedto|issued to|takenby|staff|technician|tech|signedoutby|requestedby|collectedby)$/],
  ['job',        /^(job|jobno|jobnumber|jobref|jobcard|jobcardno|workorder|wo|worksorder|ordernumber)$/],
  ['department', /^(department|dept|division|section|cost centre|costcentre|costcenter)$/],
  ['vehicle',    /^(vehicle|vehicleno|vehiclereg|reg|registration|fleet|fleetno|truck|unitno)$/],
  ['date',       /^(date|issuedate|dateissued|datetaken)$/],
  ['notes',      /^(notes|note|comment|comments|remarks|reason)$/],
];

function labelFor(text) {
  const key = importer.squash(text);

  if (!key) return null;

  for (const [field, pattern] of HEADER_LABELS) {
    if (pattern.test(key)) return field;
  }

  return null;
}

/**
 * Finds the row that starts the line table.
 *
 * A row qualifies when its cells name a product and a quantity. A bin counts
 * as naming a product: a store that signs stock out by bin writes a sheet
 * headed "Bin | Quantity" and nothing else. A row naming only a product is
 * kept as a fallback, for sheets whose quantity column is headed something the
 * importer does not recognise.
 */
function findLineHeader(grid) {
  let fallback = null;

  for (let index = 0; index < Math.min(grid.length, 30); index++) {
    const row = grid[index] || [];

    const used = new Set();
    const mapping = {};

    row.forEach((cell, column) => {
      const guess = importer.guessField(cell, used);

      if (guess) {
        used.add(guess.field);
        mapping[String(column)] = guess.field;
      }
    });

    if (
      !used.has('description') &&
      !used.has('sku') &&
      !used.has('bin_location')
    ) continue;

    if (used.has('quantity')) {
      return { index, mapping, row };
    }

    if (!fallback) fallback = { index, mapping, row };
  }

  return fallback;
}

/**
 * Reads "Employee: John Smith" out of whatever is written above the table —
 * side by side, stacked, or all in one cell.
 */
function readHeaderBlock(grid, upTo) {
  const header = {
    employee: null,
    job: null,
    department: null,
    vehicle: null,
    date: null,
    notes: null,
  };

  for (let r = 0; r < upTo; r++) {
    const row = grid[r] || [];

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '').trim();

      if (!cell) continue;

      // "Employee: John Smith" written into a single cell.
      const inline = cell.match(/^([A-Za-z][A-Za-z /]*)\s*[:\-]\s*(.+)$/);

      if (inline) {
        const key = labelFor(inline[1]);

        if (key && !header[key]) {
          header[key] = inline[2].trim();
          continue;
        }
      }

      const key = labelFor(cell);

      if (!key || header[key]) continue;

      // The value sits either to the right of the label or under it.
      let value = null;

      for (let k = c + 1; k < row.length; k++) {
        const next = String(row[k] ?? '').trim();

        if (!next) continue;
        if (labelFor(next)) break;

        value = next;
        break;
      }

      if (!value && grid[r + 1]) {
        const below = String(grid[r + 1][c] ?? '').trim();

        if (below && !labelFor(below)) value = below;
      }

      if (value) header[key] = value;
    }
  }

  return header;
}

async function extractFromSpreadsheet(filePath, mimeType) {
  const { grid } = await importer.readGrid(filePath, mimeType);

  const table = findLineHeader(grid || []);

  if (!table) {
    return {
      header: {},
      rows: [],
      provider: 'spreadsheet',
      model: null,
      source: 'SPREADSHEET',
      raw: null,
      headerConfidence: {},
    };
  }

  const header = readHeaderBlock(grid, table.index);

  // Some sheets name the employee on every line instead. Those columns are
  // not stock fields, so the importer's mapping ignores them.
  const perRow = {};

  (table.row || []).forEach((cell, column) => {
    const key = labelFor(cell);

    if (key && perRow[key] === undefined) perRow[key] = column;
  });

  const quantityColumn =
    Object.keys(table.mapping).find((k) => table.mapping[k] === 'quantity');

  const binColumn =
    Object.keys(table.mapping).find((k) => table.mapping[k] === 'bin_location');

  const rows = [];

  grid.slice(table.index + 1).forEach((raw, index) => {
    const parsed = importer.extractRow(raw, table.mapping);

    const readColumn = (name) =>
      perRow[name] !== undefined
        ? String(raw[perRow[name]] ?? '').trim() || null
        : null;

    // A repeated value down the sheet still describes the sheet as a whole.
    ['employee', 'job', 'department', 'vehicle', 'date'].forEach((field) => {
      if (!header[field]) header[field] = readColumn(field);
    });

    const bin =
      binColumn !== undefined
        ? String(raw[Number(binColumn)] ?? '').trim() || null
        : null;

    // A bin on its own identifies a product in a store that signs stock out by
    // bin number, so a row carrying only a bin and a quantity is a real row.
    if (!parsed.description && !parsed.sku && !bin) return;

    // A totals line is not stock going out.
    if (/^(total|totals|subtotal|grand total)$/i.test(String(parsed.description || '').trim())) {
      return;
    }

    const rawQuantity =
      quantityColumn !== undefined
        ? String(raw[Number(quantityColumn)] ?? '').trim()
        : '';

    rows.push({
      row_number: rows.length + 1,
      product_code: parsed.sku,
      description: parsed.description,
      bin,
      raw_quantity:
        rawQuantity || (parsed.quantity != null ? String(parsed.quantity) : null),
      // The cell is read exactly; parseQuantity still judges whether the text
      // it holds is actually a usable number.
      quantity: null,
      unit: parsed.unit_of_measure,
      notes: null,
      quantity_confidence: null,
      confidence: 1,
    });
  });

  return {
    header,
    rows,
    provider: 'spreadsheet',
    model: null,
    source: 'SPREADSHEET',
    raw: null,
    headerConfidence: {},
  };
}

async function extractFromDocument(filePath, mimeType) {
  const result =
    await ai.extractJsonFromDocument(filePath, mimeType, SHEET_PROMPT);

  const data = result.data || {};

  const rows =
    Array.isArray(data.rows)
      ? data.rows.map((row, index) => ({
          row_number: index + 1,
          product_code: row.product_code || null,
          description: row.description || null,
          bin: row.bin || null,
          raw_quantity:
            row.raw_quantity != null
              ? String(row.raw_quantity)
              : row.quantity != null
                ? String(row.quantity)
                : null,
          quantity:
            typeof row.quantity === 'number' && Number.isFinite(row.quantity)
              ? row.quantity
              : null,
          unit: row.unit || null,
          notes: row.notes || null,
          quantity_confidence:
            typeof row.quantity_confidence === 'number'
              ? Math.max(0, Math.min(1, row.quantity_confidence))
              : null,
          confidence:
            typeof row.confidence === 'number'
              ? Math.max(0, Math.min(1, row.confidence))
              : null,
        }))
      : [];

  return {
    header: {
      employee: data.employee || null,
      job: data.job || null,
      department: data.department || null,
      vehicle: data.vehicle || null,
      date: data.date || null,
      notes: data.notes || null,
    },
    rows,
    provider: result.provider,
    model: result.model,
    source: 'AI_VISION',
    raw: result.raw,
    headerConfidence: data.confidence || {},
  };
}

// ---------------------------------------------------------------------------
// PROCESSING
// ---------------------------------------------------------------------------

/**
 * Reads a sheet, matches its rows and validates them.
 *
 * Writes the result to stock_sheets / stock_sheet_rows and leaves the sheet in
 * READY or REVIEW_REQUIRED. It never touches the ledger.
 */
async function processSheet(sheetId) {
  const sheet =
    await db.get('SELECT * FROM stock_sheets WHERE id = $1', [sheetId]);

  if (!sheet) {
    throw new Error('Stock sheet not found');
  }

  if (sheet.status === 'POSTED') {
    return { status: 'POSTED', reason: 'already_posted' };
  }

  await db.run(
    `UPDATE stock_sheets SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1`,
    [sheetId]
  );

  const absolutePath =
    path.isAbsolute(sheet.file_path)
      ? sheet.file_path
      : path.join(__dirname, '..', sheet.file_path);

  let extraction;

  try {

    if (!fs.existsSync(absolutePath)) {
      throw new Error('The uploaded document is no longer available on the server.');
    }

    extraction =
      isSpreadsheet(absolutePath, sheet.mime_type)
        ? await extractFromSpreadsheet(absolutePath, sheet.mime_type)
        : await extractFromDocument(absolutePath, sheet.mime_type);

  } catch (error) {

    // A failed read must leave stock untouched and say why.
    await db.run(
      `
        UPDATE stock_sheets
        SET status = 'FAILED',
            error_message = $1,
            updated_at = NOW()
        WHERE id = $2
      `,
      [error.message, sheetId]
    );

    throw error;
  }

  if (!extraction.rows.length) {
    await db.run(
      `
        UPDATE stock_sheets
        SET status = 'FAILED',
            error_message = 'No stock lines could be read from this document.',
            extraction_provider = $1,
            extraction_source = $2,
            updated_at = NOW()
        WHERE id = $3
      `,
      [extraction.provider, extraction.source, sheetId]
    );

    throw new Error('No stock lines could be read from this document.');
  }

  const locationId = sheet.location_id || (await ledger.defaultLocationId(null));

  // Rows are replaced rather than appended, so re-running extraction on a
  // sheet cannot leave stale rows behind.
  await db.run('DELETE FROM stock_sheet_rows WHERE sheet_id = $1', [sheetId]);

  let matched = 0;
  let review = 0;
  let totalQuantity = 0;

  for (const row of extraction.rows) {

    const evaluated =
      await evaluateRow(row, { locationId });

    if (evaluated.status === 'MATCHED') {
      matched += 1;
      totalQuantity += evaluated.quantity || 0;
    } else {
      review += 1;
    }

    await db.run(
      `
        INSERT INTO stock_sheet_rows (
          id, sheet_id, row_number,
          raw_product_code, raw_description, raw_bin, raw_quantity, raw_unit,
          raw_notes,
          quantity, unit_of_measure,
          product_id, match_confidence, match_method, quantity_confidence,
          candidates, stock_before, stock_after, status, issue
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      `,
      [
        uuid(),
        sheetId,
        row.row_number,
        row.product_code,
        row.description,
        row.bin,
        row.raw_quantity,
        row.unit,
        row.notes,
        evaluated.quantity,
        row.unit || evaluated.unitOfMeasure || null,
        evaluated.productId,
        evaluated.matchConfidence,
        evaluated.matchMethod,
        evaluated.quantityConfidence,
        JSON.stringify(evaluated.candidates || []),
        evaluated.stockBefore,
        evaluated.stockAfter,
        evaluated.status,
        evaluated.issue,
      ]
    );
  }

  const status = review > 0 ? 'REVIEW_REQUIRED' : 'READY';

  await db.run(
    `
      UPDATE stock_sheets
      SET status = $1,
          employee_name = COALESCE(employee_name, $2),
          job_reference = COALESCE(job_reference, $3),
          department = COALESCE(department, $4),
          vehicle = COALESCE(vehicle, $5),
          issue_date = COALESCE(issue_date, $6),
          notes = COALESCE(notes, $7),
          header_confidence = $8,
          extraction_provider = $9,
          extraction_model = $10,
          extraction_source = $11,
          ai_raw_response = $12,
          row_count = $13,
          matched_count = $14,
          review_count = $15,
          total_quantity = $16,
          location_id = COALESCE(location_id, $17),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $18
    `,
    [
      status,
      extraction.header.employee,
      extraction.header.job,
      extraction.header.department,
      extraction.header.vehicle,
      extraction.header.date,
      extraction.header.notes,
      JSON.stringify(extraction.headerConfidence || {}),
      extraction.provider,
      extraction.model,
      extraction.source,
      extraction.raw ? String(extraction.raw).slice(0, 100000) : null,
      extraction.rows.length,
      matched,
      review,
      totalQuantity,
      locationId,
      sheetId,
    ]
  );

  return {
    status,
    row_count: extraction.rows.length,
    matched_count: matched,
    review_count: review,
  };
}

/**
 * Matches and validates a single extracted row.
 *
 * Order matters: a row is only checked for stock availability once it has a
 * real product and a real quantity, because the other two failures are more
 * useful to report.
 */
async function evaluateRow(row, { locationId }) {
  const quantityRead = parseQuantity(
    row.quantity != null ? row.quantity : row.raw_quantity
  );

  // The model's own confidence in the handwriting can only lower the result,
  // never raise it above what parsing supports.
  const quantityConfidence =
    row.quantity_confidence != null
      ? Math.min(row.quantity_confidence, quantityRead.confidence || 1)
      : quantityRead.confidence;

  // Where a store signs stock out by bin, the bin is often written into
  // whatever column the sheet has — so the code that was written is offered as
  // a bin too. A bin only resolves when it holds exactly one product, so
  // trying it costs nothing.
  const match =
    await matching.matchProduct({
      description: row.description || row.product_code || '',
      code: row.product_code || '',
      bin: row.bin || row.product_code || '',
      limit: 5,
    });

  const candidates =
    (match.candidates || []).map((candidate) => ({
      product_id: candidate.product.id,
      sku: candidate.product.sku,
      description: candidate.product.description,
      confidence: Math.round(candidate.confidence * 1000) / 1000,
      method: candidate.method,
    }));

  const base = {
    quantity: quantityRead.value,
    quantityConfidence,
    matchConfidence: match.confidence || 0,
    matchMethod: match.method,
    candidates,
    productId: null,
    stockBefore: null,
    stockAfter: null,
    unitOfMeasure: match.match ? match.match.unit_of_measure : null,
  };

  // 1. Could the product be identified at all?
  if (!match.match) {
    return {
      ...base,
      status: 'REVIEW_REQUIRED',
      issue:
        row.bin && !row.description && !row.product_code
          ? `Bin ${row.bin} is not on any product in the product master.`
          : 'No matching product could be found in the product master.',
    };
  }

  // 2. Was the identification confident and unambiguous? The matcher's own
  //    ambiguity flag catches two products that score almost identically.
  if (!match.auto || match.confidence < MANDATORY_REVIEW_THRESHOLD) {
    return {
      ...base,
      status: 'REVIEW_REQUIRED',
      issue: match.candidates.length > 1 && match.method === 'bin_shared'
        ? `More than one product is stored in bin ${row.bin || row.product_code}.`
        : match.ambiguous
        ? 'More than one product matches this description equally well.'
        : `Product match confidence is ${Math.round(
            (match.confidence || 0) * 100
          )}%, below the threshold for automatic matching.`,
    };
  }

  // A confident match is still invalid if the product is inactive — confidence
  // never overrides a hard rule.
  if (match.match.is_active === false) {
    return {
      ...base,
      productId: match.match.id,
      status: 'REVIEW_REQUIRED',
      issue: 'This product is marked inactive in the product master.',
    };
  }

  // Nor if the product is not inventory. Issuing from something nobody counts
  // would be recording a movement in a figure that does not exist.
  if (
    match.match.inventory_type === 'NON_STOCK' ||
    match.match.track_inventory === false
  ) {
    return {
      ...base,
      productId: match.match.id,
      status: 'REVIEW_REQUIRED',
      issue: 'This product is not tracked as inventory.',
    };
  }

  // 3. Is there a usable quantity?
  if (quantityRead.value === null) {
    return {
      ...base,
      productId: match.match.id,
      status: 'REVIEW_REQUIRED',
      issue:
        quantityRead.reason === 'ambiguous_quantity'
          ? 'The quantity on the sheet could not be read with confidence.'
          : 'No quantity could be read for this line.',
    };
  }

  if (quantityRead.value <= 0) {
    return {
      ...base,
      productId: match.match.id,
      status: 'REVIEW_REQUIRED',
      issue: 'The quantity must be greater than zero.',
    };
  }

  if (quantityConfidence < MANDATORY_REVIEW_THRESHOLD) {
    return {
      ...base,
      productId: match.match.id,
      status: 'REVIEW_REQUIRED',
      issue: `The quantity was read with only ${Math.round(
        quantityConfidence * 100
      )}% confidence.`,
    };
  }

  // 4. Is there enough stock?
  const stockBefore =
    await ledger.currentQuantity(null, match.match.id, locationId);

  const stockAfter = stockBefore - quantityRead.value;

  if (stockAfter < 0 && !ledger.negativeStockAllowed()) {
    return {
      ...base,
      productId: match.match.id,
      stockBefore,
      stockAfter: null,
      status: 'INSUFFICIENT_STOCK',
      issue: `Only ${stockBefore} in stock, ${quantityRead.value} requested.`,
    };
  }

  return {
    ...base,
    productId: match.match.id,
    stockBefore,
    stockAfter,
    status: 'MATCHED',
    issue: null,
  };
}

/**
 * Re-validates every row against current stock without re-reading the
 * document, so the review screen reflects movements posted since extraction.
 */
async function revalidateSheet(sheetId) {
  const sheet =
    await db.get('SELECT * FROM stock_sheets WHERE id = $1', [sheetId]);

  if (!sheet || sheet.status === 'POSTED' || sheet.status === 'CANCELLED') {
    return sheet;
  }

  const rows =
    await db.all(
      'SELECT * FROM stock_sheet_rows WHERE sheet_id = $1 ORDER BY row_number',
      [sheetId]
    );

  const locationId = sheet.location_id || (await ledger.defaultLocationId(null));

  let matched = 0;
  let review = 0;
  let totalQuantity = 0;

  for (const row of rows) {

    if (row.status === 'EXCLUDED') continue;

    let status = row.status;
    let issue = row.issue;
    let stockBefore = row.stock_before;
    let stockAfter = row.stock_after;

    if (row.product_id && row.quantity != null && Number(row.quantity) > 0) {

      const product =
        await db.get(
          'SELECT is_active FROM products WHERE id = $1',
          [row.product_id]
        );

      if (!product) {
        status = 'REVIEW_REQUIRED';
        issue = 'The selected product no longer exists.';
      } else if (product.is_active === false) {
        status = 'REVIEW_REQUIRED';
        issue = 'This product is marked inactive in the product master.';
      } else {
        stockBefore =
          await ledger.currentQuantity(null, row.product_id, locationId);

        stockAfter = stockBefore - Number(row.quantity);

        if (stockAfter < 0 && !ledger.negativeStockAllowed()) {
          status = 'INSUFFICIENT_STOCK';
          issue = `Only ${stockBefore} in stock, ${row.quantity} requested.`;
          stockAfter = null;
        } else {
          status = row.status === 'RESOLVED' ? 'RESOLVED' : 'MATCHED';
          issue = null;
        }
      }

    } else if (!row.product_id) {
      status = 'REVIEW_REQUIRED';
      issue = issue || 'No matching product could be found in the product master.';
    } else {
      status = 'REVIEW_REQUIRED';
      issue = issue || 'No quantity could be read for this line.';
    }

    const counts = status === 'MATCHED' || status === 'RESOLVED';

    if (counts) {
      matched += 1;
      totalQuantity += Number(row.quantity || 0);
    } else {
      review += 1;
    }

    await db.run(
      `
        UPDATE stock_sheet_rows
        SET status = $1, issue = $2, stock_before = $3, stock_after = $4
        WHERE id = $5
      `,
      [status, issue, stockBefore, stockAfter, row.id]
    );
  }

  const status = review > 0 ? 'REVIEW_REQUIRED' : 'READY';

  await db.run(
    `
      UPDATE stock_sheets
      SET status = $1,
          matched_count = $2,
          review_count = $3,
          total_quantity = $4,
          updated_at = NOW()
      WHERE id = $5
    `,
    [status, matched, review, totalQuantity, sheetId]
  );

  return db.get('SELECT * FROM stock_sheets WHERE id = $1', [sheetId]);
}

// ---------------------------------------------------------------------------
// POSTING
// ---------------------------------------------------------------------------

/**
 * Approves a sheet and posts its rows as STOCK_ISSUE movements.
 *
 * All-or-nothing by default: the whole sheet is validated first and a single
 * failing row blocks the entire posting, so a document can never be half
 * applied. postDocument() adds the idempotency gate, so a sheet approved twice
 * deducts once.
 */
async function postSheet(sheetId, userId) {
  const sheet =
    await db.get('SELECT * FROM stock_sheets WHERE id = $1', [sheetId]);

  if (!sheet) {
    return { posted: false, reason: 'not_found' };
  }

  if (sheet.status === 'POSTED') {
    return {
      posted: false,
      reason: 'already_posted',
      posted_at: sheet.posted_at,
    };
  }

  if (sheet.status === 'CANCELLED') {
    return { posted: false, reason: 'cancelled' };
  }

  // Re-check against live stock; another sheet may have consumed it since.
  await revalidateSheet(sheetId);

  const rows =
    await db.all(
      `
        SELECT * FROM stock_sheet_rows
        WHERE sheet_id = $1
          AND status <> 'EXCLUDED'
        ORDER BY row_number
      `,
      [sheetId]
    );

  if (!rows.length) {
    return { posted: false, reason: 'no_rows' };
  }

  const blocking =
    rows.filter(
      (row) => row.status !== 'MATCHED' && row.status !== 'RESOLVED'
    );

  if (blocking.length) {
    return {
      posted: false,
      reason: 'unresolved_rows',
      blocking: blocking.map((row) => ({
        row_number: row.row_number,
        description: row.raw_description,
        status: row.status,
        issue: row.issue,
      })),
    };
  }

  const locationId = sheet.location_id || (await ledger.defaultLocationId(null));

  const movements =
    rows.map((row) => ({
      product_id: row.product_id,
      location_id: locationId,
      transaction_type: 'STOCK_ISSUE',
      quantity: Number(row.quantity),
      source_line_id: row.id,
      employee_name: sheet.employee_name,
      job_reference: sheet.job_reference,
      reason: `Issued on stock sheet ${sheet.sheet_number}`,
      match_confidence: row.match_confidence,
      created_by: userId,
    }));

  const result =
    await ledger.postDocument({
      documentType: DOCUMENT_TYPE,
      documentId: sheetId,
      movements,
      postedBy: userId,
    });

  if (!result.posted) {
    return result;
  }

  // Link each ledger entry back to the row it came from.
  for (const transaction of result.transactions) {
    await db.run(
      `
        UPDATE stock_sheet_rows
        SET status = 'POSTED', transaction_id = $1
        WHERE id = $2
      `,
      [transaction.id, transaction.source_line_id]
    );
  }

  await db.run(
    `
      UPDATE stock_sheets
      SET status = 'POSTED',
          posted_by = $1,
          posted_at = NOW(),
          updated_at = NOW()
      WHERE id = $2
    `,
    [userId, sheetId]
  );

  return {
    posted: true,
    transaction_count: result.transactions.length,
    transactions: result.transactions,
  };
}

module.exports = {
  DOCUMENT_TYPE,
  ACCEPT_THRESHOLD,
  MANDATORY_REVIEW_THRESHOLD,
  SHEET_PROMPT,
  parseQuantity,
  nextSheetNumber,
  fileHash,
  isSpreadsheet,
  extractFromSpreadsheet,
  extractFromDocument,
  evaluateRow,
  processSheet,
  revalidateSheet,
  postSheet,
};
