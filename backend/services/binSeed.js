// services/binSeed.js
//
// Applies a bin sheet that ships with the app.
//
// Loading bins through Import Stock means uploading a file, confirming a
// column mapping and remembering to tick a box — six steps to fill in one
// field, and any one of them missed leaves the store with an empty Bin column
// and no way to tell why. The same data shipped alongside the app is one
// button.
//
// It only ever fills fields in on products that already exist: nothing is
// created, no quantity is touched, and no ledger entry is written.

const fs = require('fs');
const path = require('path');

const db = require('../db');
const matching = require('./productMatching');

const SEED_PATH = path.join(__dirname, '..', 'seed-data', 'stock-bins.json');

function readSeed() {
  if (!fs.existsSync(SEED_PATH)) {
    return { source: null, rows: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

    return {
      source: parsed.source || null,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    };
  } catch (error) {
    throw new Error(`The bundled bin sheet could not be read: ${error.message}`);
  }
}

/**
 * How much of the bundled sheet is still outstanding.
 *
 * One set-based query rather than a row-by-row walk: this runs every time the
 * products screen loads, and 2,000 round trips to decide whether to show a
 * banner would make the screen slower than the thing it is offering to do.
 */
async function preview() {
  const { source, rows } = readSeed();

  if (!rows.length) {
    return { source, row_count: 0, matched: 0, unmatched: 0, pending_bins: 0, pending_groups: 0 };
  }

  const codes = rows.map((row) => (row.code ? String(row.code).trim() : ''));
  const normalized =
    rows.map((row) => matching.normalizeDescription(row.description || ''));
  const bins = rows.map((row) => String(row.bin || '').trim());
  const normalizedBins = rows.map((row) => matching.normalizeCode(row.bin || ''));
  const groups = rows.map((row) => String(row.group || ''));

  const result =
    await db.get(
      `
        WITH seed AS (
          SELECT *
          FROM unnest(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[]
          ) AS t(code, normalized_description, bin, normalized_bin, stock_group)
        ),
        resolved AS (
          SELECT seed.*, hit.id AS product_id, hit.stock_group AS current_group
          FROM seed
          LEFT JOIN LATERAL (
            SELECT p.id, p.stock_group
            FROM products p
            WHERE p.is_active = TRUE
              AND (
                (seed.code <> '' AND (
                  p.sku = seed.code
                  OR p.supplier_product_code = seed.code
                  OR p.product_code = seed.code
                ))
                OR (
                  seed.normalized_description <> ''
                  AND p.normalized_description = seed.normalized_description
                )
              )
            -- The same rungs, in the same order, with the same tie-break as
            -- findProduct(): a preview that resolves a row differently from
            -- the run itself reports work that is already done.
            ORDER BY
              CASE
                WHEN seed.code <> '' AND p.sku = seed.code THEN 1
                WHEN seed.code <> '' AND p.supplier_product_code = seed.code THEN 2
                WHEN seed.code <> '' AND p.product_code = seed.code THEN 3
                ELSE 4
              END,
              p.created_at,
              p.id
            LIMIT 1
          ) hit ON TRUE
        )
        SELECT
          COUNT(*) FILTER (WHERE product_id IS NOT NULL)::int AS matched,
          COUNT(*) FILTER (WHERE product_id IS NULL)::int AS unmatched,
          COUNT(*) FILTER (
            WHERE product_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM product_bins pb
                WHERE pb.product_id = resolved.product_id
                  AND pb.normalized_bin = resolved.normalized_bin
              )
          )::int AS pending_bins,
          COUNT(*) FILTER (
            WHERE product_id IS NOT NULL
              AND stock_group <> ''
              AND COALESCE(NULLIF(TRIM(current_group), ''), '') = ''
          )::int AS pending_groups
        FROM resolved
      `,
      [codes, normalized, bins, normalizedBins, groups]
    );

  return {
    source,
    row_count: rows.length,
    matched: Number(result?.matched || 0),
    unmatched: Number(result?.unmatched || 0),
    pending_bins: Number(result?.pending_bins || 0),
    pending_groups: Number(result?.pending_groups || 0),
  };
}

/**
 * What the bundled sheet holds, without changing anything.
 */
function summary() {
  const { source, rows } = readSeed();

  const groups = {};

  rows.forEach((row) => {
    const key = row.group || 'Ungrouped';

    groups[key] = (groups[key] || 0) + 1;
  });

  return {
    source,
    row_count: rows.length,
    groups: Object.entries(groups).map(([name, count]) => ({ name, count })),
  };
}

/**
 * Finds the product a bin sheet row refers to.
 *
 * The same ladder the importer uses, and for the same reason: a store does not
 * always identify its stock by the same column twice.
 */
async function findProduct(client, row) {
  const code = row.code ? String(row.code).trim() : '';
  const description = row.description ? String(row.description).trim() : '';

  // Two products can share a code or a wording. Which one is picked has to be
  // the same every time, or a second run finds work the first one thought it
  // had done — so every rung orders before it limits.
  const first = async (sql, params) => {
    const result = await client.query(sql, params);

    return result.rows.length ? result.rows[0].id : null;
  };

  if (code) {
    const bySku =
      await first(
        `SELECT id FROM products WHERE is_active = TRUE AND sku = $1
         ORDER BY created_at, id LIMIT 1`,
        [code]
      );

    if (bySku) return bySku;

    const bySupplierCode =
      await first(
        `SELECT id FROM products WHERE is_active = TRUE AND supplier_product_code = $1
         ORDER BY created_at, id LIMIT 1`,
        [code]
      );

    if (bySupplierCode) return bySupplierCode;

    const byProductCode =
      await first(
        `SELECT id FROM products WHERE is_active = TRUE AND product_code = $1
         ORDER BY created_at, id LIMIT 1`,
        [code]
      );

    if (byProductCode) return byProductCode;
  }

  if (description) {
    const normalized = matching.normalizeDescription(description);

    return first(
      `SELECT id FROM products
       WHERE is_active = TRUE AND normalized_description = $1
       ORDER BY created_at, id LIMIT 1`,
      [normalized]
    );
  }

  return null;
}

/**
 * Applies the bundled sheet.
 *
 * @param {object} options
 * @param {string} [options.userId]
 * @param {boolean} [options.dryRun] - report what would happen, change nothing
 * @returns {Promise<object>} what was matched, recorded and left over
 */
async function apply({ userId, dryRun } = {}) {
  const { source, rows } = readSeed();

  if (!rows.length) {
    return {
      applied: false,
      reason: 'no_seed',
      source,
      row_count: 0,
    };
  }

  let matched = 0;
  let unmatched = 0;
  let binsRecorded = 0;
  let grouped = 0;

  const groupCounts = {};
  const misses = [];

  await db.transaction(async (client) => {
    for (const row of rows) {
      const productId = await findProduct(client, row);

      if (!productId) {
        unmatched += 1;

        if (misses.length < 25) {
          misses.push(row.description || row.code || '(unnamed row)');
        }

        continue;
      }

      matched += 1;

      if (dryRun) continue;

      const added =
        await matching.rememberBin(
          { productId, bin: row.bin, source: 'bundled_sheet', userId },
          client
        );

      if (added) binsRecorded += 1;

      if (row.group) {
        // A group already set by hand is left alone.
        const result =
          await client.query(
            `
              UPDATE products
              SET stock_group = $1, updated_at = NOW()
              WHERE id = $2
                AND COALESCE(NULLIF(TRIM(stock_group), ''), '') = ''
            `,
            [row.group, productId]
          );

        if (result.rowCount) {
          grouped += 1;
          groupCounts[row.group] = (groupCounts[row.group] || 0) + 1;
        }
      }
    }
  });

  return {
    applied: !dryRun,
    dry_run: Boolean(dryRun),
    source,
    row_count: rows.length,
    matched,
    unmatched,
    bins_recorded: binsRecorded,
    grouped,
    groups: Object.entries(groupCounts).map(([name, count]) => ({ name, count })),
    unmatched_examples: misses,
  };
}

module.exports = {
  SEED_PATH,
  readSeed,
  summary,
  preview,
  apply,
};
