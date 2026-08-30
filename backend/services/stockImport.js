// services/stockImport.js
//
// Reads an existing stock spreadsheet, works out what its columns mean, and
// turns the confirmed result into opening balance transactions.
//
// Real stock sheets do not use predictable headers — "Product No", "Item Code",
// "Stock Code" and "SKU" all mean the same thing — so the importer guesses,
// shows its guess, and lets a person correct it before anything is written.
//
// Import never sets a quantity column directly. Each row becomes an
// OPENING_BALANCE transaction, so imported stock enters the same ledger as
// every later movement and is auditable in the same way.

const fs = require('fs');
const path = require('path');

const ExcelJS = require('exceljs');

// The fields a spreadsheet column can be mapped onto.
const TARGET_FIELDS = [
  { key: 'sku',                   label: 'SKU / Product Code', required: false },
  { key: 'description',           label: 'Product Description', required: true },
  { key: 'quantity',              label: 'Opening Quantity', required: false },
  { key: 'unit_cost',             label: 'Unit Cost', required: false },
  { key: 'unit_of_measure',       label: 'Unit', required: false },
  { key: 'category',              label: 'Category', required: false },
  { key: 'supplier_name',         label: 'Supplier', required: false },
  { key: 'supplier_product_code', label: 'Supplier Product Code', required: false },
  { key: 'barcode',               label: 'Barcode', required: false },
  { key: 'reorder_level',         label: 'Reorder Level', required: false },
  { key: 'bin_location',          label: 'Bin Number', required: false },
];

// Header wordings seen in the wild, most specific first. Matching is done on a
// squashed lower-case form so spacing and punctuation do not matter.
const HEADER_HINTS = [
  ['bin_location',          ['bin', 'binno', 'binnumber', 'binnr', 'bincode', 'binlocation', 'binloc', 'storagebin', 'shelf', 'shelfno', 'rack', 'rackno', 'aisle', 'slot', 'position', 'location', 'storagelocation', 'warehouselocation', 'pickface', 'pickslot']],
  ['supplier_product_code', ['supplierproductcode', 'suppliercode', 'suppliersku', 'vendorcode', 'manufacturercode', 'mfrcode', 'partno', 'partnumber']],
  ['reorder_level',         ['reorderlevel', 'reorderpoint', 'reorder', 'minlevel', 'minimumlevel', 'minstock', 'minqty', 'reorderqty', 'safetystock', 'rol']],
  ['unit_cost',             ['unitcost', 'cost', 'costprice', 'price', 'unitprice', 'buyprice', 'purchaseprice', 'costeach', 'rate', 'avgcost', 'averagecost']],
  ['quantity',              ['quantity', 'qty', 'qtyonhand', 'onhand', 'stock', 'stockonhand', 'soh', 'closingqty', 'openingqty', 'openingbalance', 'openingstock', 'balance', 'count', 'instock', 'currentstock', 'qtyinstock', 'qoh']],
  ['unit_of_measure',       ['unit', 'uom', 'unitofmeasure', 'measure', 'packsize', 'pack', 'each', 'um']],
  ['category',              ['category', 'cat', 'group', 'grp', 'productgroup', 'type', 'department', 'dept', 'class', 'family', 'range']],
  ['supplier_name',         ['supplier', 'suppliername', 'supp', 'vendor', 'vendorname', 'manufacturer', 'mfr', 'brand', 'make']],
  ['barcode',               ['barcode', 'ean', 'upc', 'gtin', 'scancode']],
  ['sku',                   ['sku', 'productcode', 'productno', 'productnumber', 'itemcode', 'itemno', 'itemnumber', 'stockcode', 'stockno', 'code', 'ref', 'reference', 'catalogue', 'catalog']],
  ['description',           ['description', 'productdescription', 'itemdescription', 'product', 'productname', 'item', 'itemname', 'name', 'details', 'desc']],
];

function squash(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Guesses which target field a spreadsheet header means.
 *
 * Exact matches win over prefixes so a "Cost" column is not stolen by a rule
 * that merely contains "cost".
 */
function guessField(header, alreadyUsed) {
  const key = squash(header);

  if (!key) return null;

  for (const [field, hints] of HEADER_HINTS) {
    if (alreadyUsed.has(field)) continue;

    if (hints.includes(key)) {
      return { field, confidence: 1 };
    }
  }

  for (const [field, hints] of HEADER_HINTS) {
    if (alreadyUsed.has(field)) continue;

    if (hints.some((hint) => key.startsWith(hint) || hint.startsWith(key))) {
      return { field, confidence: 0.8 };
    }
  }

  // Substring matching only for hints long enough to be meaningful. A
  // three-letter abbreviation hides inside unrelated words — "location"
  // contains "cat" — and a wrong guess is worse than no guess, because a
  // person has to notice it to undo it.
  for (const [field, hints] of HEADER_HINTS) {
    if (alreadyUsed.has(field)) continue;

    if (hints.some((hint) => hint.length >= 4 && key.includes(hint))) {
      return { field, confidence: 0.6 };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------

/**
 * Splits one CSV line, honouring quoted fields and doubled quotes.
 */
function parseCsvLine(line) {
  const values = [];

  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',' || ch === ';' || ch === '\t') {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current.trim());

  return values;
}

function parseCsv(text) {
  const lines =
    text
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim().length);

  if (!lines.length) {
    return { headers: [], rows: [] };
  }

  return {
    headers: parseCsvLine(lines[0]),
    rows: lines.slice(1).map(parseCsvLine),
  };
}

function cellText(cell) {
  const value = cell && cell.value;

  if (value == null) return '';

  // ExcelJS returns objects for formulas, rich text and hyperlinks.
  if (typeof value === 'object') {
    if (value.result !== undefined) return String(value.result ?? '');
    if (value.text !== undefined) return String(value.text ?? '');
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return '';
  }

  return String(value);
}

async function workbookGrid(filePath) {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.readFile(filePath);

  const sheet =
    workbook.worksheets.find((ws) => ws.rowCount > 1) ||
    workbook.worksheets[0];

  if (!sheet) {
    throw new Error('The spreadsheet contains no readable sheets.');
  }

  const grid = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellText(cell);
    });

    grid.push(
      Array.from(
        { length: values.length },
        (_, i) => (values[i] == null ? '' : values[i])
      )
    );
  });

  return { grid, sheetName: sheet.name };
}

async function parseWorkbook(filePath) {
  const { grid, sheetName } = await workbookGrid(filePath);

  if (!grid.length) {
    return { headers: [], rows: [], sheetName };
  }

  // Stock sheets often start with a title or a blank line. The header is the
  // first row with several non-empty cells that is followed by more rows.
  let headerIndex = 0;

  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const filled = grid[i].filter((v) => String(v).trim()).length;

    if (filled >= 2) {
      headerIndex = i;
      break;
    }
  }

  return {
    headers: grid[headerIndex] || [],
    rows: grid.slice(headerIndex + 1),
    sheetName,
  };
}

/**
 * Returns the sheet exactly as it is laid out, header rows and all.
 *
 * inspectSpreadsheet decides where the table starts, which is right for a
 * stock list. A sign-out sheet often carries its employee and job above that
 * table, so the caller needs the untouched grid to read them.
 */
async function readGrid(filePath, mimeType) {
  const extension = path.extname(filePath).toLowerCase();

  const isCsv =
    extension === '.csv' ||
    extension === '.tsv' ||
    String(mimeType || '').includes('csv');

  if (!isCsv) {
    return workbookGrid(filePath);
  }

  const parsed = parseCsv(fs.readFileSync(filePath, 'utf8'));

  return {
    grid: parsed.headers.length ? [parsed.headers, ...parsed.rows] : [],
    sheetName: null,
  };
}

/**
 * Reads a spreadsheet and proposes a column mapping.
 *
 * @returns {Promise<{headers, rows, sample, mapping, sheetName, totalRows}>}
 */
async function inspectSpreadsheet(filePath, mimeType) {
  const extension = path.extname(filePath).toLowerCase();

  const isCsv =
    extension === '.csv' ||
    extension === '.tsv' ||
    String(mimeType || '').includes('csv');

  const parsed = isCsv
    ? parseCsv(fs.readFileSync(filePath, 'utf8'))
    : await parseWorkbook(filePath);

  const headers = (parsed.headers || []).map((h) => String(h || '').trim());

  // Drop trailing blank columns Excel likes to add.
  while (headers.length && !headers[headers.length - 1]) {
    headers.pop();
  }

  const used = new Set();
  const mapping = {};
  const confidence = {};

  headers.forEach((header, index) => {
    const guess = guessField(header, used);

    if (guess) {
      used.add(guess.field);
      mapping[String(index)] = guess.field;
      confidence[String(index)] = guess.confidence;
    } else {
      mapping[String(index)] = null;
    }
  });

  const rows =
    (parsed.rows || []).filter(
      (row) => row.some((cell) => String(cell ?? '').trim())
    );

  return {
    sheetName: parsed.sheetName || null,
    headers,
    mapping,
    confidence,
    totalRows: rows.length,
    // Enough rows for a person to confirm the mapping is right.
    sample: rows.slice(0, 10),
    rows,
  };
}

// ---------------------------------------------------------------------------
// ROW EXTRACTION
// ---------------------------------------------------------------------------

function toNumber(value) {
  if (value == null || value === '') return null;

  // Handles "1 234,56", "R1,234.56", "(12)" for negatives and trailing units.
  const text = String(value).trim();

  const negative = /^\(.*\)$/.test(text);

  let cleaned = text
    .replace(/[()]/g, '')
    .replace(/[^\d,.\-]/g, '');

  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimals = cleaned.length - lastComma - 1;

    cleaned = decimals > 0 && decimals <= 2
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  }

  const number = Number(cleaned);

  if (!Number.isFinite(number)) return null;

  return negative ? -number : number;
}

/**
 * Applies a confirmed mapping to one spreadsheet row.
 */
function extractRow(row, mapping) {
  const out = {};

  Object.entries(mapping || {}).forEach(([index, field]) => {
    if (!field) return;

    const raw = row[Number(index)];

    if (raw == null || String(raw).trim() === '') return;

    out[field] = String(raw).trim();
  });

  return {
    sku: out.sku || null,
    description: out.description || null,
    category: out.category || null,
    unit_of_measure: out.unit_of_measure || null,
    supplier_name: out.supplier_name || null,
    supplier_product_code: out.supplier_product_code || null,
    barcode: out.barcode || null,
    bin_location: out.bin_location || null,
    quantity: toNumber(out.quantity),
    unit_cost: toNumber(out.unit_cost),
    reorder_level: toNumber(out.reorder_level),
  };
}

module.exports = {
  TARGET_FIELDS,
  squash,
  guessField,
  parseCsv,
  parseCsvLine,
  inspectSpreadsheet,
  readGrid,
  extractRow,
  toNumber,
};
