// services/aiExtraction.js
//
// InvoiceFlow — Production AI Invoice Extraction
//
// PROVIDER: Google Gemini ONLY
//
// IMPORTANT:
// - No mock extraction.
// - No fake invoice data.
// - No Claude fallback.
// - Gemini failures are thrown to the caller.
// - Never silently invent invoice information.
//

const fs = require('fs');

// ---------------------------------------------------------------------------
// GEMINI CONFIGURATION
// ---------------------------------------------------------------------------

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || '';

const GEMINI_MODEL =
  (process.env.GEMINI_MODEL || 'gemini-3.6-flash')
    .replace(/^models\//, '')
    .trim();


// ---------------------------------------------------------------------------
// REQUIRED FIELDS
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = [
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


// ---------------------------------------------------------------------------
// EXTRACTION PROMPT
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `
You are an invoice data extraction engine for a South African accounts-payable system.

You will be given an image or PDF of an invoice.

Extract the invoice information accurately from the document.

Return ONLY valid JSON.

The JSON must have this exact structure:

{
  "invoice_number": string|null,
  "supplier_name": string|null,
  "supplier_vat_number": string|null,
  "invoice_date": string|null,
  "due_date": string|null,
  "purchase_order_number": string|null,
  "subtotal": number|null,
  "vat_amount": number|null,
  "total_amount": number|null,
  "currency": string|null,
  "payment_terms": string|null,
  "supplier_address": string|null,
  "supplier_contact": string|null,
  "line_items": [
    {
      "description": string|null,
      "quantity": number|null,
      "unit_price": number|null,
      "vat": number|null,
      "total": number|null
    }
  ],
  "confidence": {
    "invoice_number": number,
    "supplier_name": number,
    "supplier_vat_number": number,
    "invoice_date": number,
    "due_date": number,
    "purchase_order_number": number,
    "subtotal": number,
    "vat_amount": number,
    "total_amount": number,
    "currency": number,
    "payment_terms": number,
    "supplier_address": number,
    "supplier_contact": number
  }
}

RULES:

1. Never invent information.
2. Never guess missing information.
3. If a field is not visible or cannot be read reliably, return null.
4. Confidence values must be between 0.0 and 1.0.
5. Confidence represents how clearly and reliably the value was read from the document.
6. Dates must use YYYY-MM-DD where possible.
7. Numbers must be plain numbers without currency symbols or thousands separators.
8. Do not assume a VAT rate.
9. Only report VAT if it is printed or unambiguously derivable from the invoice.
10. Currency must use ISO 4217 codes such as ZAR, USD, GBP or EUR.
11. For South African invoices with clear R/ZAR indicators, use ZAR.
12. Extract every visible invoice line item.
13. Do not create line items that are not present.
14. Preserve supplier names and invoice numbers as printed where possible.
15. Extract purchase/order numbers into purchase_order_number.
16. Do not substitute information from another invoice or external knowledge.
17. If information is unclear, use null rather than guessing.
18. Return ONLY the JSON object.
`;


// ===========================================================================
// GEMINI EXTRACTION
// ===========================================================================

async function extractWithGemini(filePath, mimeType) {

  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured'
    );
  }

  if (!filePath) {
    throw new Error(
      'Invoice file path is missing'
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Invoice file does not exist: ${filePath}`
    );
  }

  const fileBuffer =
    fs.readFileSync(filePath);

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error(
      'Invoice file is empty'
    );
  }

  const base64 =
    fileBuffer.toString('base64');

  const effectiveMimeType =
    mimeType || 'application/octet-stream';

  console.log(
    `[aiExtraction] Gemini model: ${GEMINI_MODEL}`
  );

  console.log(
    `[aiExtraction] Gemini MIME type: ${effectiveMimeType}`
  );

  // Gemini expects the model name without "models/".
  //
  // Correct:
  // gemini-3.6-flash
  //
  // Incorrect:
  // models/gemini-3.6-flash

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        role: 'user',

        parts: [

          {
            inline_data: {
              mime_type: effectiveMimeType,
              data: base64
            }
          },

          {
            text: EXTRACTION_SYSTEM_PROMPT
          }

        ]
      }
    ],

    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json'
    }
  };

  console.log(
    '[aiExtraction] Sending invoice to Gemini...'
  );

  let response;

  try {

    response = await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify(body)
      }
    );

  } catch (error) {

    throw new Error(
      `Unable to connect to Gemini API: ${error.message}`
    );
  }

  const responseText =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `Gemini API error ${response.status}: ${responseText}`
    );
  }

  let data;

  try {

    data =
      JSON.parse(responseText);

  } catch (error) {

    throw new Error(
      `Gemini returned invalid API response JSON: ${error.message}`
    );
  }

  const candidates =
    Array.isArray(data.candidates)
      ? data.candidates
      : [];

  if (!candidates.length) {

    const blockReason =
      data?.promptFeedback?.blockReason;

    if (blockReason) {

      throw new Error(
        `Gemini blocked the invoice request: ${blockReason}`
      );
    }

    throw new Error(
      'Gemini API returned no candidates'
    );
  }

  const candidate =
    candidates[0];

  if (
    candidate?.finishReason &&
    candidate.finishReason !== 'STOP'
  ) {

    console.warn(
      `[aiExtraction] Gemini finish reason: ${candidate.finishReason}`
    );
  }

  const parts =
    candidate?.content?.parts || [];

  const text =
    parts
      .map(part => part?.text || '')
      .join('')
      .trim();

  if (!text) {

    throw new Error(
      'Gemini API returned no extraction text'
    );
  }

  console.log(
    '[aiExtraction] Gemini returned extraction data'
  );

  // Gemini should return JSON directly because responseMimeType
  // is application/json. This cleanup simply protects against
  // accidental markdown fences.

  const cleaned =
    text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

  let parsed;

  try {

    parsed =
      JSON.parse(cleaned);

  } catch (error) {

    console.error(
      '[aiExtraction] Gemini raw extraction response:',
      text
    );

    throw new Error(
      `Gemini returned invalid extraction JSON: ${error.message}`
    );
  }

  return normalizeExtraction(
    parsed,
    {
      provider: 'gemini',
      model: GEMINI_MODEL
    }
  );
}


// ===========================================================================
// NORMALIZATION
// ===========================================================================

function normalizeExtraction(
  parsed,
  raw
) {

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {

    throw new Error(
      'Gemini extraction result is not a valid JSON object'
    );
  }

  const fields = {};

  for (
    const field of REQUIRED_FIELDS
  ) {

    fields[field] =
      parsed[field] !== undefined
        ? parsed[field]
        : null;
  }


  // -------------------------------------------------------------------------
  // NORMALIZE LINE ITEMS
  // -------------------------------------------------------------------------

  const lineItems =
    Array.isArray(parsed.line_items)
      ? parsed.line_items.map(item => ({

          description:
            item?.description ??
            null,

          quantity:
            normalizeNumber(
              item?.quantity
            ),

          unit_price:
            normalizeNumber(
              item?.unit_price
            ),

          vat:
            normalizeNumber(
              item?.vat
            ),

          total:
            normalizeNumber(
              item?.total
            )

        }))
      : [];


  // -------------------------------------------------------------------------
  // NORMALIZE NUMERIC FIELDS
  // -------------------------------------------------------------------------

  fields.subtotal =
    normalizeNumber(
      fields.subtotal
    );

  fields.vat_amount =
    normalizeNumber(
      fields.vat_amount
    );

  fields.total_amount =
    normalizeNumber(
      fields.total_amount
    );


  // -------------------------------------------------------------------------
  // NORMALIZE CONFIDENCE
  // -------------------------------------------------------------------------

  const confidence = {};

  for (
    const field of REQUIRED_FIELDS
  ) {

    const value =
      parsed?.confidence?.[field];

    confidence[field] =
      typeof value === 'number'
        ? Math.max(
            0,
            Math.min(
              1,
              value
            )
          )
        : null;
  }


  // -------------------------------------------------------------------------
  // RETURN NORMALIZED EXTRACTION
  // -------------------------------------------------------------------------

  return {

    fields,

    lineItems,

    confidence,

    raw
  };
}


// ===========================================================================
// NUMBER NORMALIZATION
// ===========================================================================

function normalizeNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'number'
  ) {

    return Number.isFinite(value)
      ? value
      : null;
  }

  if (
    typeof value === 'string'
  ) {

    const cleaned =
      value
        .replace(/,/g, '')
        .replace(/[^\d.-]/g, '')
        .trim();

    if (!cleaned) {
      return null;
    }

    const parsed =
      Number(cleaned);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}


// ===========================================================================
// MAIN EXTRACTION
// ===========================================================================

async function extractInvoice(
  filePath,
  mimeType
) {

  console.log(
    '[aiExtraction] Starting production Gemini extraction'
  );

  console.log(
    `[aiExtraction] Model: ${GEMINI_MODEL}`
  );

  // -------------------------------------------------------------------------
  // GEMINI ONLY
  // -------------------------------------------------------------------------

  if (!GEMINI_API_KEY) {

    throw new Error(
      'Gemini extraction unavailable: GEMINI_API_KEY is missing'
    );
  }

  try {

    const extraction =
      await extractWithGemini(
        filePath,
        mimeType
      );

    console.log(
      '[aiExtraction] Gemini extraction successful'
    );

    return {

      ...extraction,

      provider:
        'gemini',

      model:
        GEMINI_MODEL
    };

  } catch (error) {

    console.error(
      '[aiExtraction] Gemini extraction failed:',
      error.message
    );

    // IMPORTANT:
    //
    // There is intentionally NO fallback here.
    //
    // We do NOT generate fake invoice data.
    // We do NOT call Claude.
    // We do NOT call a mock provider.
    //
    // The real Gemini error is propagated to the invoice
    // processing route so the invoice can be marked as failed
    // rather than populated with fake information.

    throw error;
  }
}


// ===========================================================================
// EXPORTS
// ===========================================================================

module.exports = {

  extractInvoice,

  REQUIRED_FIELDS

};


