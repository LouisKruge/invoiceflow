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
 * What the bundled sheet holds. Reads the file, touches no data.
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
 * The seed as parallel arrays, which is how it is handed to Postgres — five
 * parameters rather than one per cell.
 */
function columns(rows) {
  return {
    codes: rows.map((row) => (row.code ? String(row.code).trim() : '')),
    normalized: rows.map((row) => matching.normalizeDescription(row.description || '')),
    bins: rows.map((row) => String(row.bin || '').trim()),
    normalizedBins: rows.map((row) => matching.normalizeCode(row.bin || '')),
    groups: rows.map((row) => String(row.group || '')),
  };
}

// Resolving every seed row to a product, in one pass.
//
// The rungs are the same ones the importer climbs — SKU, the supplier's code,
// the product code, then the wording — and the tie-break is explicit, because
// two products can share a code and a preview that resolves a row differently
// from the run reports work that is already done.
const RESOLVE = `
  seed AS (
    SELECT *
    FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
      WITH ORDINALITY AS t(
        code, normalized_description, bin, normalized_bin, stock_group, ord
      )
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
`;

/**
 * How much of the bundled sheet is still outstanding.
 *
 * This runs every time the products screen loads, so it is one query rather
 * than a walk: two thousand round trips to decide whether to show a banner
 * would make the screen slower than the thing it is offering to do.
 */
async function preview() {
  const { source, rows } = readSeed();

  if (!rows.length) {
    return {
      source,
      row_count: 0,
      matched: 0,
      unmatched: 0,
      pending_bins: 0,
      pending_groups: 0,
    };
  }

  const { codes, normalized, bins, normalizedBins, groups } = columns(rows);

  const result =
    await db.get(
      `
        WITH ${RESOLVE}
        SELECT
          COUNT(*) FILTER (WHERE product_id IS NOT NULL)::int AS matched,
          COUNT(*) FILTER (WHERE product_id IS NULL)::int AS unmatched,
          COUNT(*) FILTER (
            WHERE product_id IS NOT NULL
              AND normalized_bin <> ''
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
 * Applies the bundled sheet.
 *
 * Two thousand rows resolved one at a time is roughly ten thousand round
 * trips. Against a database on the same machine that is twenty seconds;
 * against a hosted one it is several minutes, and the request waiting on it
 * times out long before it finishes — which looks, from a browser, exactly
 * like a button that does nothing.
 *
 * So it is one statement: resolve every row, insert the bins that are missing,
 * set the primary bin, set the group. Each product's first bin in sheet order
 * becomes its primary one, and a bin or group already set by hand is left
 * alone.
 *
 * @param {object} options
 * @param {string} [options.userId]
 */
async function apply({ userId } = {}) {
  const { source, rows } = readSeed();

  if (!rows.length) {
    return { applied: false, reason: 'no_seed', source, row_count: 0 };
  }

  const { codes, normalized, bins, normalizedBins, groups } = columns(rows);

  const result =
    await db.get(
      `
        WITH ${RESOLVE},
        landing AS (
          SELECT * FROM resolved
          WHERE product_id IS NOT NULL
            AND normalized_bin <> ''
        ),
        recorded AS (
          INSERT INTO product_bins
            (id, product_id, bin, normalized_bin, source, created_by)
          SELECT
            gen_random_uuid()::text,
            d.product_id,
            d.bin,
            d.normalized_bin,
            'bundled_sheet',
            $6
          FROM (
            SELECT DISTINCT ON (product_id, normalized_bin) *
            FROM landing
            ORDER BY product_id, normalized_bin, ord
          ) d
          ON CONFLICT (product_id, normalized_bin) DO NOTHING
          RETURNING product_id
        ),
        -- The bin and the group are set by one UPDATE rather than two.
        -- Postgres runs every data-modifying branch of a statement against the
        -- same snapshot, and leaves the result unspecified when two of them
        -- touch the same row — which silently cost the groups when the bins
        -- were written first.
        per_product AS (
          SELECT
            product_id,
            (array_agg(bin ORDER BY ord) FILTER (WHERE normalized_bin <> ''))[1]
              AS first_bin,
            (array_agg(stock_group ORDER BY ord) FILTER (WHERE stock_group <> ''))[1]
              AS first_group
          FROM resolved
          WHERE product_id IS NOT NULL
          GROUP BY product_id
        ),
        -- Read before the update lands, so the counts describe what changed
        -- rather than what is now true.
        pending AS (
          SELECT
            pp.product_id,
            (
              COALESCE(NULLIF(TRIM(p.bin_location), ''), '') = ''
              AND pp.first_bin IS NOT NULL
            ) AS sets_bin,
            (
              COALESCE(NULLIF(TRIM(p.stock_group), ''), '') = ''
              AND pp.first_group IS NOT NULL
            ) AS sets_group
          FROM per_product pp
          JOIN products p ON p.id = pp.product_id
        ),
        touched AS (
          UPDATE products p
          SET
            bin_location =
              CASE
                WHEN COALESCE(NULLIF(TRIM(p.bin_location), ''), '') = ''
                  AND pp.first_bin IS NOT NULL
                THEN pp.first_bin
                ELSE p.bin_location
              END,
            stock_group =
              CASE
                WHEN COALESCE(NULLIF(TRIM(p.stock_group), ''), '') = ''
                  AND pp.first_group IS NOT NULL
                THEN pp.first_group
                ELSE p.stock_group
              END,
            updated_at = NOW()
          FROM per_product pp
          WHERE p.id = pp.product_id
          RETURNING p.id
        )
        SELECT
          (SELECT COUNT(*) FROM resolved WHERE product_id IS NOT NULL)::int AS matched,
          (SELECT COUNT(*) FROM resolved WHERE product_id IS NULL)::int AS unmatched,
          (SELECT COUNT(*) FROM recorded)::int AS bins_recorded,
          (SELECT COUNT(*) FROM pending WHERE sets_bin)::int AS primary_bins_set,
          (SELECT COUNT(*) FROM pending WHERE sets_group)::int AS grouped,
          (SELECT COUNT(*) FROM touched)::int AS products_touched
      `,
      [codes, normalized, bins, normalizedBins, groups, userId || null]
    );

  const groupCounts =
    await db.all(
      `
        SELECT stock_group AS name, COUNT(*)::int AS count
        FROM products
        WHERE is_active = TRUE
          AND COALESCE(NULLIF(TRIM(stock_group), ''), '') <> ''
        GROUP BY stock_group
        ORDER BY stock_group
      `
    );

  return {
    applied: true,
    source,
    row_count: rows.length,
    matched: Number(result?.matched || 0),
    unmatched: Number(result?.unmatched || 0),
    bins_recorded: Number(result?.bins_recorded || 0),
    primary_bins_set: Number(result?.primary_bins_set || 0),
    grouped: Number(result?.grouped || 0),
    groups: groupCounts,
  };
}

module.exports = {
  SEED_PATH,
  readSeed,
  summary,
  columns,
  preview,
  apply,
};
