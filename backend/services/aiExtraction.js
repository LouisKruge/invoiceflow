// services/aiExtraction.js
//
// InvoiceFlow AI Invoice Extraction
//
// Primary provider: Gemini
// Optional provider: Claude
//
// IMPORTANT:
// - No mock data.
// - No fake invoices.
// - No fake suppliers.
// - Gemini failures are NOT converted into fake data.
// - If AI extraction fails, the actual error is returned.
//

const fs = require('fs');

// ---------------------------------------------------------------------------
// PROVIDER CONFIGURATION
// ---------------------------------------------------------------------------

const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const GEMINI_MODEL =
  (process.env.GEMINI_MODEL || 'gemini-3.6-flash')
    .replace(/^models\//, '')
    .trim();

const CLAUDE_API_KEY =
  process.env.ANTHROPIC_API_KEY || '';

const CLAUDE_MODEL =
  (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6').trim();


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

Extract the invoice information accurately.

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

1. Never invent or guess information.
2. If a field is not visible or cannot be read confidently, return null.
3. Confidence values must be between 0.0 and 1.0.
4. Confidence represents how clearly and reliably the value was read.
5. Dates must use YYYY-MM-DD where possible.
6. Numbers must be plain numbers without currency symbols or thousands separators.
7. Do not assume a VAT rate.
8. Only report VAT if printed or unambiguously derivable.
9. Currency should use ISO 4217 codes such as ZAR, USD, GBP or EUR.
10. For a South African invoice with clear R/ZAR indicators, use ZAR.
11. Extract every visible invoice line item.
12. Do not create line items that are not present.
13. Preserve supplier names and invoice numbers as printed where possible.
14. Extract purchase/order numbers into purchase_order_number.
15. If information is unreadable, return null rather than guessing.
16. Return ONLY the JSON object.
`;


// ===========================================================================
// GEMINI
// ===========================================================================

async function extractWithGemini(filePath, mimeType) {

  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured'
    );
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(
      `Invoice file does not exist: ${filePath}`
    );
  }

  const fileBuffer = fs.readFileSync(filePath);

  const base64 = fileBuffer.toString('base64');

  const effectiveMimeType =
    mimeType || 'application/octet-stream';

  console.log(
    `[aiExtraction] Gemini model: ${GEMINI_MODEL}`
  );

  console.log(
    `[aiExtraction] Gemini MIME type: ${effectiveMimeType}`
  );

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
      `Gemini network error: ${error.message}`
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

    data = JSON.parse(responseText);

  } catch (error) {

    throw new Error(
      `Gemini returned invalid API JSON: ${error.message}`
    );
  }

  const candidates =
    data.candidates || [];

  if (!candidates.length) {

    const finishReason =
      data.candidates?.[0]?.finishReason;

    throw new Error(
      `Gemini API returned no candidates${finishReason ? ` (${finishReason})` : ''}`
    );
  }

  const parts =
    candidates[0]?.content?.parts || [];

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

  const cleaned =
    text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

  let parsed;

  try {

    parsed = JSON.parse(cleaned);

  } catch (error) {

    console.error(
      '[aiExtraction] Gemini raw response:',
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
      model: GEMINI_MODEL,
      usageMetadata: data.usageMetadata || null
    }
  );
}


// ===========================================================================
// CLAUDE
// ===========================================================================

async function extractWithClaude(
  filePath,
  mimeType
) {

  if (!CLAUDE_API_KEY) {

    throw new Error(
      'ANTHROPIC_API_KEY is not configured'
    );
  }

  if (!filePath || !fs.existsSync(filePath)) {

    throw new Error(
      `Invoice file does not exist: ${filePath}`
    );
  }

  if (!mimeType) {

    throw new Error(
      'MIME type is required for Claude extraction'
    );
  }

  const fileBuffer =
    fs.readFileSync(filePath);

  const base64 =
    fileBuffer.toString('base64');

  const body = {

    model: CLAUDE_MODEL,

    max_tokens: 4000,

    system:
      EXTRACTION_SYSTEM_PROMPT,

    messages: [
      {
        role: 'user',

        content: [

          {
            type: 'image',

            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64
            }
          },

          {
            type: 'text',

            text:
              'Extract this invoice as the specified JSON object. Return only JSON.'
          }

        ]
      }
    ]
  };

  console.log(
    `[aiExtraction] Claude model: ${CLAUDE_MODEL}`
  );

  console.log(
    `[aiExtraction] Claude MIME type: ${mimeType}`
  );

  let response;

  try {

    response =
      await fetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',

          headers: {
            'content-type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01'
          },

          body:
            JSON.stringify(body)
        }
      );

  } catch (error) {

    throw new Error(
      `Claude network error: ${error.message}`
    );
  }

  const responseText =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `Claude API error ${response.status}: ${responseText}`
    );
  }

  let data;

  try {

    data =
      JSON.parse(responseText);

  } catch (error) {

    throw new Error(
      `Claude returned invalid API JSON: ${error.message}`
    );
  }

  const text =
    (data.content || [])
      .filter(
        block =>
          block.type === 'text'
      )
      .map(
        block =>
          block.text || ''
      )
      .join('')
      .trim();

  if (!text) {

    throw new Error(
      'Claude API returned no extraction text'
    );
  }

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
      '[aiExtraction] Claude raw response:',
      text
    );

    throw new Error(
      `Claude returned invalid extraction JSON: ${error.message}`
    );
  }

  return normalizeExtraction(
    parsed,
    {
      provider: 'claude',
      model: CLAUDE_MODEL,
      usage: data.usage || null
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
    typeof parsed !== 'object'
  ) {

    throw new Error(
      'AI returned an invalid extraction object'
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

  const lineItems =
    Array.isArray(
      parsed.line_items
    )
      ? parsed.line_items.map(
          item => ({

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

          })
        )
      : [];

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

  const parsed =
    Number(
      String(value)
        .replace(/,/g, '')
        .trim()
    );

  return Number.isFinite(parsed)
    ? parsed
    : null;
}


// ===========================================================================
// MAIN EXTRACTION
// ===========================================================================

async function extractInvoice(
  filePath,
  mimeType
) {

  console.log(
    `[aiExtraction] Provider selected: ${PROVIDER}`
  );


  // -------------------------------------------------------------------------
  // GEMINI
  // -------------------------------------------------------------------------

  if (
    PROVIDER === 'gemini'
  ) {

    if (!GEMINI_API_KEY) {

      throw new Error(
        'AI_PROVIDER=gemini but GEMINI_API_KEY is missing'
      );
    }

    console.log(
      `[aiExtraction] Using Gemini ${GEMINI_MODEL}`
    );

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
          'gemini'
      };

    } catch (error) {

      console.error(
        '[aiExtraction] Gemini extraction failed:',
        error.message
      );

      // IMPORTANT:
      // Never create fake invoice data.
      // Never fall back to mock data.

      throw error;
    }
  }


  // -------------------------------------------------------------------------
  // CLAUDE
  // -------------------------------------------------------------------------

  if (
    PROVIDER === 'claude'
  ) {

    if (!CLAUDE_API_KEY) {

      throw new Error(
        'AI_PROVIDER=claude but ANTHROPIC_API_KEY is missing'
      );
    }

    console.log(
      `[aiExtraction] Using Claude ${CLAUDE_MODEL}`
    );

    try {

      const extraction =
        await extractWithClaude(
          filePath,
          mimeType
        );

      console.log(
        '[aiExtraction] Claude extraction successful'
      );

      return {

        ...extraction,

        provider:
          'claude'
      };

    } catch (error) {

      console.error(
        '[aiExtraction] Claude extraction failed:',
        error.message
      );

      // IMPORTANT:
      // Never create fake invoice data.

      throw error;
    }
  }


  // -------------------------------------------------------------------------
  // UNSUPPORTED PROVIDER
  // -------------------------------------------------------------------------

  throw new Error(
    `Unsupported AI_PROVIDER: "${PROVIDER}". Use "gemini" or "claude".`
  );
}


// ===========================================================================
// EXPORTS
// ===========================================================================

module.exports = {

  extractInvoice,

  REQUIRED_FIELDS

};
