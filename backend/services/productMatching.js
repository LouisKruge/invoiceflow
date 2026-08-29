// services/productMatching.js
//
// Resolves a line of text from a document ("6205 2RS BEARING", "SKF 6205-2RS")
// to a canonical product in the Product Master.
//
// The same supplier will write the same part three different ways, so matching
// runs a ladder of strategies from certain to speculative and attaches a
// confidence to whatever it finds. Nothing below the auto-match threshold is
// ever allowed to move stock on its own — it goes to the review queue, and the
// answer a person gives there is remembered so the next document resolves
// without asking.

const { v4: uuid } = require('uuid');

const db = require('../db');

// Confidence at or above this resolves automatically.
const AUTO_MATCH_THRESHOLD = (() => {
  const raw = Number(process.env.STOCK_MATCH_THRESHOLD);

  return Number.isFinite(raw) && raw > 0 && raw <= 1
    ? raw
    : 0.9;
})();

// Below this a candidate is too weak to be worth showing as a suggestion.
const SUGGESTION_FLOOR = 0.4;

// Methods that identify a product outright rather than by resemblance. When
// the winner came from one of these, a close fuzzy runner-up is not evidence
// of ambiguity — an exact SKU or an exact description is simply better
// evidence than something that merely looks similar.
const CERTAIN_METHODS = new Set([
  'learned_mapping',
  'barcode',
  'sku',
  'supplier_code',
  'normalized_description',
]);

// How far ahead the best candidate must be before it is trusted on its own.
//
// Similarity alone is not enough to post stock. "SKF 6205-2RS" and
// "FAG 6205-2RS" are different parts that score almost identically against
// "6205 BEARING 2RS", and picking whichever happens to rank first would
// silently corrupt one of the two balances. When the top two are this close
// the line is ambiguous by definition and belongs in the review queue.
const AMBIGUITY_MARGIN = (() => {
  const raw = Number(process.env.STOCK_MATCH_MARGIN);

  return Number.isFinite(raw) && raw >= 0 && raw < 1
    ? raw
    : 0.08;
})();

// ---------------------------------------------------------------------------
// NORMALIZATION
// ---------------------------------------------------------------------------

/**
 * Reduces free text to a comparable form: lower case, no punctuation, no
 * filler words, tokens sorted.
 *
 * Sorting the tokens is what makes "6205 2RS BEARING" and "BEARING 6205 2RS"
 * the same string, which is the single biggest win in this data.
 */
function normalizeDescription(text) {
  if (!text) return '';

  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'for', 'with',
    'x', 'ea', 'each', 'pcs', 'pc', 'unit', 'units', 'no',
  ]);

  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token))
    .sort()
    .join(' ')
    .trim();
}

/**
 * Codes are compared without separators, so "SKF 6205-2RS" and "skf62052rs"
 * are the same code.
 */
function normalizeCode(code) {
  if (!code) return '';

  return String(code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// SIMILARITY
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    previous = current;
  }

  return previous[b.length];
}

/**
 * Blends token overlap with edit distance.
 *
 * Token overlap alone treats "6205 bearing" and "6206 bearing" as a strong
 * match even though the part number differs, so edit distance is mixed in to
 * punish near-miss digits. Numeric tokens are weighted more heavily because in
 * this catalogue they carry the identity.
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);

  if (!tokensA.length || !tokensB.length) return 0;

  const setB = new Set(tokensB);

  let matched = 0;
  let weight = 0;
  let matchedWeight = 0;

  for (const token of tokensA) {
    // A digit-bearing token is an identifier; a word is a descriptor.
    const tokenWeight = /\d/.test(token) ? 2.5 : 1;

    weight += tokenWeight;

    if (setB.has(token)) {
      matched += 1;
      matchedWeight += tokenWeight;
    }
  }

  const overlap = weight ? matchedWeight / weight : 0;

  // Penalize length mismatch so a short string does not score highly against
  // a much longer one just because all its tokens appear.
  const lengthRatio =
    Math.min(tokensA.length, tokensB.length) /
    Math.max(tokensA.length, tokensB.length);

  const distance = levenshtein(a, b);
  const editScore = 1 - distance / Math.max(a.length, b.length);

  return (overlap * 0.6) + (lengthRatio * 0.15) + (Math.max(0, editScore) * 0.25);
}

// ---------------------------------------------------------------------------
// MATCHING
// ---------------------------------------------------------------------------

/**
 * Finds the products that could be meant by a document line.
 *
 * @param {object} query
 * @param {string} query.description - the text as printed on the document
 * @param {string} [query.code] - supplier product code / SKU as printed
 * @param {string} [query.barcode]
 * @param {string} [query.supplier_id] - narrows and boosts candidates
 * @param {number} [query.limit]
 * @returns {Promise<{match, confidence, method, candidates, auto}>}
 */
async function matchProduct(query = {}) {
  const description = query.description || '';
  const code = query.code || '';
  const barcode = query.barcode || '';
  const supplierId = query.supplier_id || null;
  const limit = query.limit || 5;

  const normalizedDescription = normalizeDescription(description);
  const normalizedCode = normalizeCode(code);

  const candidates = new Map();

  // Keeps the strongest score seen for a product across strategies.
  //
  // A candidate already identified outright is never relabelled by a later
  // fuzzy pass: the method is what tells the caller how much to trust the
  // score, so losing it would defeat the ambiguity check.
  const consider = (product, confidence, method) => {
    if (!product) return;

    const existing = candidates.get(product.id);

    if (existing && CERTAIN_METHODS.has(existing.method)) {
      // Keep the certain identification, but let a stronger score through.
      if (confidence > existing.confidence) {
        candidates.set(product.id, {
          product,
          confidence,
          method: existing.method,
        });
      }

      return;
    }

    if (!existing || confidence > existing.confidence) {
      candidates.set(product.id, { product, confidence, method });
    }
  };

  // -------------------------------------------------------------------------
  // 1. A mapping a person already confirmed for this supplier's wording.
  //    This outranks everything: it is a recorded human decision.
  // -------------------------------------------------------------------------

  if (normalizedDescription) {
    const learned =
      await db.get(
        `
          SELECT m.*, p.*
          FROM document_product_matches m
          JOIN products p ON p.id = m.product_id
          WHERE m.normalized_text = $1
            AND COALESCE(m.supplier_id, '') = COALESCE($2, '')
            AND p.is_active = TRUE
          LIMIT 1
        `,
        [normalizedDescription, supplierId]
      );

    if (learned) {
      return {
        match: learned,
        confidence: 1,
        method: 'learned_mapping',
        auto: true,
        candidates: [
          { product: learned, confidence: 1, method: 'learned_mapping' },
        ],
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Barcode — unambiguous when present.
  // -------------------------------------------------------------------------

  if (barcode) {
    const row =
      await db.get(
        `
          SELECT * FROM products
          WHERE barcode = $1 AND is_active = TRUE
          LIMIT 1
        `,
        [barcode]
      );

    consider(row, 1, 'barcode');
  }

  // -------------------------------------------------------------------------
  // 3. Exact SKU or product code, compared without separators.
  // -------------------------------------------------------------------------

  if (normalizedCode) {
    const rows =
      await db.all(
        `
          SELECT * FROM products
          WHERE is_active = TRUE
            AND (
              UPPER(REGEXP_REPLACE(COALESCE(sku, ''), '[^A-Za-z0-9]', '', 'g')) = $1
              OR UPPER(REGEXP_REPLACE(COALESCE(product_code, ''), '[^A-Za-z0-9]', '', 'g')) = $1
            )
          LIMIT 5
        `,
        [normalizedCode]
      );

    rows.forEach((row) => consider(row, 0.99, 'sku'));

    // 4. Supplier's own code for the product, which only means anything in the
    //    context of that supplier.
    const supplierRows =
      await db.all(
        `
          SELECT * FROM products
          WHERE is_active = TRUE
            AND UPPER(REGEXP_REPLACE(COALESCE(supplier_product_code, ''), '[^A-Za-z0-9]', '', 'g')) = $1
            AND ($2::text IS NULL OR supplier_id = $2)
          LIMIT 5
        `,
        [normalizedCode, supplierId]
      );

    supplierRows.forEach((row) => consider(row, 0.97, 'supplier_code'));
  }

  // -------------------------------------------------------------------------
  // 5 & 6. Description: exact, then normalized, then fuzzy.
  // -------------------------------------------------------------------------

  if (normalizedDescription) {
    const exact =
      await db.all(
        `
          SELECT * FROM products
          WHERE is_active = TRUE
            AND normalized_description = $1
          LIMIT 5
        `,
        [normalizedDescription]
      );

    exact.forEach((row) => consider(row, 0.95, 'normalized_description'));

    // Fuzzy pass. Pre-filtered in SQL on the most distinctive token so this
    // does not scan the whole catalogue for every line.
    const tokens =
      normalizedDescription
        .split(' ')
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .slice(0, 4);

    if (tokens.length) {
      const conditions =
        tokens.map((_, i) => `normalized_description LIKE $${i + 1}`).join(' OR ');

      const pool =
        await db.all(
          `
            SELECT * FROM products
            WHERE is_active = TRUE
              AND (${conditions})
            LIMIT 200
          `,
          tokens.map((token) => `%${token}%`)
        );

      for (const row of pool) {
        const score =
          similarity(normalizedDescription, row.normalized_description || '');

        if (score >= SUGGESTION_FLOOR) {
          // 7. Supplier context: the same wording from the supplier that
          //    actually sells the part is more likely to be that part.
          //
          // Capped, but never below the unboosted score — a boost that
          // lowered a strong match would be worse than no boost at all.
          const boosted =
            supplierId && row.supplier_id === supplierId
              ? Math.max(score, Math.min(0.97, score + 0.05))
              : score;

          consider(row, boosted, 'fuzzy_description');
        }
      }
    }
  }

  const ranked =
    Array.from(candidates.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

  const best = ranked[0] || null;
  const runnerUp = ranked[1] || null;

  // A clear winner is one that is both confident enough and meaningfully
  // ahead of whatever came second.
  const margin =
    best && runnerUp
      ? best.confidence - runnerUp.confidence
      : 1;

  // Only a fuzzy winner can be ambiguous.
  const ambiguous =
    Boolean(
      best &&
      runnerUp &&
      !CERTAIN_METHODS.has(best.method) &&
      margin < AMBIGUITY_MARGIN
    );

  return {
    match: best ? best.product : null,
    confidence: best ? best.confidence : 0,
    method: best ? best.method : null,
    auto: Boolean(
      best &&
      best.confidence >= AUTO_MATCH_THRESHOLD &&
      !ambiguous
    ),
    ambiguous,
    margin: best ? Math.round(margin * 1000) / 1000 : 0,
    candidates: ranked,
  };
}

/**
 * Records the answer a person gave in the review queue so the same supplier
 * wording resolves automatically next time.
 */
async function rememberMatch({
  supplierId,
  sourceText,
  sourceCode,
  productId,
  method,
  confidence,
  userId,
}) {
  const normalized = normalizeDescription(sourceText);

  if (!normalized || !productId) {
    return null;
  }

  const result =
    await db.run(
      `
        INSERT INTO document_product_matches (
          id, supplier_id, source_text, normalized_text, source_code,
          product_id, match_method, confidence, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (COALESCE(supplier_id, ''), normalized_text)
        DO UPDATE SET
          product_id = EXCLUDED.product_id,
          match_method = EXCLUDED.match_method,
          confidence = EXCLUDED.confidence,
          times_used = document_product_matches.times_used + 1,
          updated_at = NOW()
        RETURNING *
      `,
      [
        uuid(),
        supplierId || null,
        sourceText || '',
        normalized,
        sourceCode || null,
        productId,
        method || 'manual_review',
        confidence ?? 1,
        userId || null,
      ]
    );

  return result.rows[0] || null;
}

module.exports = {
  AUTO_MATCH_THRESHOLD,
  SUGGESTION_FLOOR,
  AMBIGUITY_MARGIN,
  CERTAIN_METHODS,
  normalizeDescription,
  normalizeCode,
  similarity,
  matchProduct,
  rememberMatch,
};
