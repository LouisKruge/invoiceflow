// services/aiExtraction.js
//
// InvoiceFlow AI Invoice Extraction
//
// Primary provider: Gemini
// Optional provider: Claude
//
// Supports:
// - JPG / JPEG
// - PNG
// - WEBP
// - PDF
//
// IMPORTANT:
// - No mock data.
// - No fake invoices.
// - No fake suppliers.
// - AI failures are returned as real errors.
// - Missing/unreadable fields are returned as null.
//

const fs = require('fs');

// ===========================================================================
// PROVIDER CONFIGURATION
// ===========================================================================

const PROVIDER =
  String(process.env.AI_PROVIDER || 'gemini')
    .trim()
    .toLowerCase();

const GEMINI_API_KEY =
  String(process.env.GEMINI_API_KEY || '').trim();

// Use a current Gemini Flash model through Render env when possible.
// You can override this with GEMINI_MODEL.
const GEMINI_MODEL =
  String(
    process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  )
    .replace(/^models\//, '')
    .trim();

const CLAUDE_API_KEY =
  String(process.env.ANTHROPIC_API_KEY || '').trim();

const CLAUDE_MODEL =
  String(
    process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
  ).trim();


// ===========================================================================
// REQUIRED FIELDS
// ===========================================================================

const REQUIRED_FIELDS = [
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


// ===========================================================================
// EXTRACTION PROMPT
// ===========================================================================

const EXTRACTION_SYSTEM_PROMPT = `
You are an invoice data extraction engine for a South African accounts-payable system.

You will be given an image or PDF of an invoice.

Your job is to extract ONLY information that is actually visible on the invoice.

Return ONLY valid JSON.

The JSON must have exactly this structure:

{
  "invoice_number": string|null,
  "supplier_name": string|null,
  "supplier_vat_number": string|null,
  "invoice_date": string|null,
  "due_date": string|null,
  "purchase_order_number": string|null,
  "account_code": string|null,
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
      "supplier_product_code": string|null,
      "unit_of_measure": string|null,
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
    "account_code": number,
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
3. If a field is not visible or cannot be read confidently, return null.
4. Confidence values must be between 0.0 and 1.0.
5. Confidence represents how clearly and reliably the value was read.
6. Dates should use YYYY-MM-DD where possible.
7. Numbers must be plain numbers.
8. Do not include currency symbols in numeric fields.
9. Do not include thousands separators in numeric fields.
10. Do not assume a VAT rate.
11. Only report VAT if it is printed or can be unambiguously calculated from the invoice.
12. Currency should use ISO 4217 codes such as ZAR, USD, GBP or EUR.
13. If the invoice clearly uses R or ZAR, return ZAR.
14. Extract every visible invoice line item.
15. Do not create line items that are not visible.
16. Where a line prints the supplier's own part or stock code, copy it into
    supplier_product_code exactly as shown, and any unit (ea, m, kg, box) into
    unit_of_measure. Leave them null when the invoice does not show them.
16. Preserve supplier names and invoice numbers as printed wherever possible.
17. Extract purchase/order numbers into purchase_order_number.
17a. Extract the customer/trading ACCOUNT CODE into account_code.
17b. The account code is the supplier's internal code for the customer being
     invoiced. It is usually a short alphanumeric code such as EVE001, ABC123,
     CASH001 or MTN0042, and is normally printed near the top of the invoice
     beside a label such as "Account", "Account Code", "Account No",
     "Acc No", "A/C", "Customer Code", "Client Code", "Debtor Code" or
     "Customer Account".
17c. Return account_code exactly as printed, uppercase, with no spaces around it.
17d. account_code is NOT the invoice number, NOT the purchase order number,
     NOT the VAT number and NOT a bank account number. If the only number you
     can find is one of those, return null for account_code.
17e. If no account code is printed on the invoice, return null.
18. If information is unreadable, return null.
19. Do not infer information from other invoices.
20. Do not create fake supplier information.
21. Do not create fake invoice information.
22. Return ONLY the JSON object.
`;


// ===========================================================================
// HELPERS
// ===========================================================================

function ensureFileExists(filePath) {

  if (!filePath) {
    throw new Error(
      'No invoice file path was provided.'
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Invoice file does not exist: ${filePath}`
    );
  }

}


// ===========================================================================
// MIME TYPE NORMALIZATION
// ===========================================================================

function normalizeMimeType(mimeType, filePath) {

  if (mimeType) {

    const normalized =
      String(mimeType)
        .trim()
        .toLowerCase();

    // JPEG aliases
    if (
      normalized === 'image/jpg' ||
      normalized === 'image/jpeg'
    ) {
      return 'image/jpeg';
    }

    if (normalized === 'image/png') {
      return 'image/png';
    }

    if (normalized === 'image/webp') {
      return 'image/webp';
    }

    if (normalized === 'application/pdf') {
      return 'application/pdf';
    }

  }

  // Fallback to file extension
  if (filePath) {

    const extension =
      String(filePath)
        .toLowerCase()
        .split('.')
        .pop();

    if (
      extension === 'jpg' ||
      extension === 'jpeg'
    ) {
      return 'image/jpeg';
    }

    if (extension === 'png') {
      return 'image/png';
    }

    if (extension === 'webp') {
      return 'image/webp';
    }

    if (extension === 'pdf') {
      return 'application/pdf';
    }

  }

  return null;

}


// ===========================================================================
// SUPPORTED MIME TYPE
// ===========================================================================

function isSupportedMimeType(mimeType) {

  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ].includes(mimeType);

}


// ===========================================================================
// GEMINI
// ===========================================================================

async function extractWithGemini(
  filePath,
  mimeType
) {

  // -------------------------------------------------------------------------
  // API KEY
  // -------------------------------------------------------------------------

  if (!GEMINI_API_KEY) {

    throw new Error(
      'GEMINI_API_KEY is not configured in the server environment.'
    );

  }

  // -------------------------------------------------------------------------
  // FILE
  // -------------------------------------------------------------------------

  ensureFileExists(filePath);

  // -------------------------------------------------------------------------
  // MIME TYPE
  // -------------------------------------------------------------------------

  const effectiveMimeType =
    normalizeMimeType(
      mimeType,
      filePath
    );

  if (!effectiveMimeType) {

    throw new Error(
      'Unable to determine invoice file type.'
    );

  }

  if (!isSupportedMimeType(effectiveMimeType)) {

    throw new Error(
      `Unsupported invoice MIME type: ${effectiveMimeType}`
    );

  }

  // -------------------------------------------------------------------------
  // FILE SIZE
  // -------------------------------------------------------------------------

  const stats =
    fs.statSync(filePath);

  console.log(
    `[aiExtraction] Gemini file size: ${stats.size} bytes`
  );

  // -------------------------------------------------------------------------
  // READ FILE
  // -------------------------------------------------------------------------

  let fileBuffer;

  try {

    fileBuffer =
      fs.readFileSync(filePath);

  } catch (error) {

    throw new Error(
      `Unable to read invoice file: ${error.message}`
    );

  }

  const base64 =
    fileBuffer.toString('base64');

  // -------------------------------------------------------------------------
  // LOG CONFIG
  // -------------------------------------------------------------------------

  console.log(
    `[aiExtraction] Gemini model: ${GEMINI_MODEL}`
  );

  console.log(
    `[aiExtraction] Gemini MIME type: ${effectiveMimeType}`
  );

  console.log(
    `[aiExtraction] Gemini invoice file loaded successfully`
  );

  // -------------------------------------------------------------------------
  // API URL
  // -------------------------------------------------------------------------

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`;

  // -------------------------------------------------------------------------
  // REQUEST BODY
  // -------------------------------------------------------------------------

  const body = {

    contents: [

      {
        role: 'user',

        parts: [

          {
            inline_data: {
              mime_type:
                effectiveMimeType,

              data:
                base64
            }
          },

          {
            text:
              EXTRACTION_SYSTEM_PROMPT
          }

        ]

      }

    ],

    generationConfig: {

      temperature: 0,

      responseMimeType:
        'application/json'

    }

  };

  // -------------------------------------------------------------------------
  // REQUEST
  // -------------------------------------------------------------------------

  console.log(
    '[aiExtraction] Sending invoice to Gemini...'
  );

  let response;

  try {

    response =
      await fetch(
        url,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(body)
        }
      );

  } catch (error) {

    throw new Error(
      `Gemini network error: ${error.message}`
    );

  }

  // -------------------------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------------------------

  const responseText =
    await response.text();

  if (!response.ok) {

    let readableError =
      responseText;

    try {

      const errorBody =
        JSON.parse(responseText);

      if (
        errorBody?.error?.message
      ) {

        readableError =
          errorBody.error.message;

      }

    } catch (_) {
      // Keep original response text
    }

    throw new Error(
      `Gemini API error ${response.status}: ${readableError}`
    );

  }

  // -------------------------------------------------------------------------
  // PARSE API RESPONSE
  // -------------------------------------------------------------------------

  let data;

  try {

    data =
      JSON.parse(responseText);

  } catch (error) {

    throw new Error(
      `Gemini returned invalid API JSON: ${error.message}`
    );

  }

  // -------------------------------------------------------------------------
  // CANDIDATES
  // -------------------------------------------------------------------------

  const candidates =
    Array.isArray(data.candidates)
      ? data.candidates
      : [];

  if (!candidates.length) {

    const apiError =
      data?.error?.message;

    if (apiError) {

      throw new Error(
        `Gemini API returned no candidates: ${apiError}`
      );

    }

    throw new Error(
      'Gemini API returned no candidates.'
    );

  }

  // -------------------------------------------------------------------------
  // FINISH REASON
  // -------------------------------------------------------------------------

  const candidate =
    candidates[0];

  const finishReason =
    candidate?.finishReason || null;

  if (
    finishReason &&
    finishReason !== 'STOP'
  ) {

    console.warn(
      `[aiExtraction] Gemini finish reason: ${finishReason}`
    );

  }

  // -------------------------------------------------------------------------
  // RESPONSE PARTS
  // -------------------------------------------------------------------------

  const parts =
    candidate?.content?.parts || [];

  const text =
    parts
      .map(
        part =>
          part?.text || ''
      )
      .join('')
      .trim();

  if (!text) {

    throw new Error(
      `Gemini returned no extraction text${
        finishReason
          ? ` (finish reason: ${finishReason})`
          : ''
      }`
    );

  }

  console.log(
    '[aiExtraction] Gemini returned extraction data.'
  );

  // -------------------------------------------------------------------------
  // CLEAN JSON
  // -------------------------------------------------------------------------

  const cleaned =
    cleanJsonResponse(text);

  // -------------------------------------------------------------------------
  // PARSE EXTRACTION
  // -------------------------------------------------------------------------

  let parsed;

  try {

    parsed =
      JSON.parse(cleaned);

  } catch (error) {

    console.error(
      '[aiExtraction] Gemini raw response:',
      text
    );

    throw new Error(
      `Gemini returned invalid extraction JSON: ${error.message}`
    );

  }

  // -------------------------------------------------------------------------
  // NORMALIZE
  // -------------------------------------------------------------------------

  return normalizeExtraction(
    parsed,
    {
      provider: 'gemini',
      model: GEMINI_MODEL,
      usageMetadata:
        data.usageMetadata || null
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

  // -------------------------------------------------------------------------
  // API KEY
  // -------------------------------------------------------------------------

  if (!CLAUDE_API_KEY) {

    throw new Error(
      'ANTHROPIC_API_KEY is not configured in the server environment.'
    );

  }

  // -------------------------------------------------------------------------
  // FILE
  // -------------------------------------------------------------------------

  ensureFileExists(filePath);

  // -------------------------------------------------------------------------
  // MIME TYPE
  // -------------------------------------------------------------------------

  const effectiveMimeType =
    normalizeMimeType(
      mimeType,
      filePath
    );

  if (!effectiveMimeType) {

    throw new Error(
      'Unable to determine invoice file type for Claude.'
    );

  }

  if (!isSupportedMimeType(effectiveMimeType)) {

    throw new Error(
      `Unsupported invoice MIME type for Claude: ${effectiveMimeType}`
    );

  }

  // -------------------------------------------------------------------------
  // READ FILE
  // -------------------------------------------------------------------------

  let fileBuffer;

  try {

    fileBuffer =
      fs.readFileSync(filePath);

  } catch (error) {

    throw new Error(
      `Unable to read invoice file: ${error.message}`
    );

  }

  const base64 =
    fileBuffer.toString('base64');

  // -------------------------------------------------------------------------
  // CONTENT
  //
  // Claude uses:
  // - image block for images
  // - document block for PDFs
  // -------------------------------------------------------------------------

  const content = [];

  if (
    effectiveMimeType ===
    'application/pdf'
  ) {

    content.push({

      type: 'document',

      source: {

        type: 'base64',

        media_type:
          'application/pdf',

        data:
          base64

      }

    });

  } else {

    content.push({

      type: 'image',

      source: {

        type: 'base64',

        media_type:
          effectiveMimeType,

        data:
          base64

      }

    });

  }

  content.push({

    type: 'text',

    text:
      'Extract this invoice according to the system instructions. Return only the JSON object.'

  });

  // -------------------------------------------------------------------------
  // REQUEST BODY
  // -------------------------------------------------------------------------

  const body = {

    model:
      CLAUDE_MODEL,

    max_tokens:
      4000,

    system:
      EXTRACTION_SYSTEM_PROMPT,

    messages: [

      {
        role: 'user',

        content

      }

    ]

  };

  console.log(
    `[aiExtraction] Claude model: ${CLAUDE_MODEL}`
  );

  console.log(
    `[aiExtraction] Claude MIME type: ${effectiveMimeType}`
  );

  console.log(
    '[aiExtraction] Sending invoice to Claude...'
  );

  // -------------------------------------------------------------------------
  // REQUEST
  // -------------------------------------------------------------------------

  let response;

  try {

    response =
      await fetch(
        'https://api.anthropic.com/v1/messages',
        {

          method: 'POST',

          headers: {

            'content-type':
              'application/json',

            'x-api-key':
              CLAUDE_API_KEY,

            'anthropic-version':
              '2023-06-01'

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

  // -------------------------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------------------------

  const responseText =
    await response.text();

  if (!response.ok) {

    let readableError =
      responseText;

    try {

      const errorBody =
        JSON.parse(responseText);

      if (
        errorBody?.error?.message
      ) {

        readableError =
          errorBody.error.message;

      }

    } catch (_) {
      // Keep original response text
    }

    throw new Error(
      `Claude API error ${response.status}: ${readableError}`
    );

  }

  // -------------------------------------------------------------------------
  // PARSE RESPONSE
  // -------------------------------------------------------------------------

  let data;

  try {

    data =
      JSON.parse(responseText);

  } catch (error) {

    throw new Error(
      `Claude returned invalid API JSON: ${error.message}`
    );

  }

  // -------------------------------------------------------------------------
  // TEXT
  // -------------------------------------------------------------------------

  const text =
    (data.content || [])
      .filter(
        block =>
          block?.type === 'text'
      )
      .map(
        block =>
          block?.text || ''
      )
      .join('')
      .trim();

  if (!text) {

    throw new Error(
      'Claude API returned no extraction text.'
    );

  }

  console.log(
    '[aiExtraction] Claude returned extraction data.'
  );

  // -------------------------------------------------------------------------
  // CLEAN JSON
  // -------------------------------------------------------------------------

  const cleaned =
    cleanJsonResponse(text);

  // -------------------------------------------------------------------------
  // PARSE EXTRACTION
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // NORMALIZE
  // -------------------------------------------------------------------------

  return normalizeExtraction(
    parsed,
    {
      provider: 'claude',
      model: CLAUDE_MODEL,
      usage:
        data.usage || null
    }
  );

}


// ===========================================================================
// CLEAN JSON RESPONSE
// ===========================================================================

function cleanJsonResponse(text) {

  if (!text) {
    return '';
  }

  let cleaned =
    String(text).trim();

  // Remove markdown JSON fences
  cleaned =
    cleaned.replace(
      /^```json\s*/i,
      ''
    );

  cleaned =
    cleaned.replace(
      /^```\s*/i,
      ''
    );

  cleaned =
    cleaned.replace(
      /\s*```$/i,
      ''
    );

  cleaned =
    cleaned.trim();

  // If the model returned extra text around the JSON,
  // attempt to isolate the outer JSON object.
  if (
    !cleaned.startsWith('{')
  ) {

    const firstBrace =
      cleaned.indexOf('{');

    const lastBrace =
      cleaned.lastIndexOf('}');

    if (
      firstBrace !== -1 &&
      lastBrace !== -1 &&
      lastBrace > firstBrace
    ) {

      cleaned =
        cleaned.substring(
          firstBrace,
          lastBrace + 1
        );

    }

  }

  return cleaned;

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
      'AI returned an invalid extraction object.'
    );

  }

  const fields = {};

  // -------------------------------------------------------------------------
  // FIELDS
  // -------------------------------------------------------------------------

  for (
    const field of REQUIRED_FIELDS
  ) {

    const value =
      parsed[field];

    fields[field] =
      value !== undefined
        ? normalizeFieldValue(
            field,
            value
          )
        : null;

  }

  // -------------------------------------------------------------------------
  // LINE ITEMS
  // -------------------------------------------------------------------------

  const lineItems =
    Array.isArray(
      parsed.line_items
    )
      ? parsed.line_items.map(
          item => ({

            description:
              item?.description !== undefined &&
              item?.description !== null
                ? String(
                    item.description
                  ).trim()
                : null,

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
              ),

            // The supplier's own code for the part, where the invoice prints
            // one. It identifies a product far more reliably than the wording
            // does, so it is worth carrying even when it is often absent.
            supplier_product_code:
              item?.supplier_product_code
                ? String(item.supplier_product_code).trim()
                : null,

            unit_of_measure:
              item?.unit_of_measure
                ? String(item.unit_of_measure).trim()
                : null

          })
        )
      : [];

  // -------------------------------------------------------------------------
  // CONFIDENCE
  // -------------------------------------------------------------------------

  const confidence = {};

  for (
    const field of REQUIRED_FIELDS
  ) {

    const value =
      parsed?.confidence?.[field];

    confidence[field] =
      typeof value === 'number' &&
      Number.isFinite(value)
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
  // RETURN
  // -------------------------------------------------------------------------

  return {

    fields,

    lineItems,

    confidence,

    raw

  };

}


// ===========================================================================
// FIELD NORMALIZATION
// ===========================================================================

function normalizeFieldValue(
  field,
  value
) {

  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {

    return null;

  }

  // Numeric fields
  if (
    field === 'subtotal' ||
    field === 'vat_amount' ||
    field === 'total_amount'
  ) {

    return normalizeNumber(
      value
    );

  }

  // Currency
  if (
    field === 'currency'
  ) {

    return String(
      value
    )
      .trim()
      .toUpperCase();

  }

  // Account code — codes like "eve 001" or "Acc: EVE001" are printed
  // inconsistently, so normalize to a bare uppercase token. Returning null
  // for a label-only match keeps a meaningless value out of the record.
  if (
    field === 'account_code'
  ) {

    const code =
      String(value)
        .replace(
          /^\s*(account(\s+(code|number|no\.?))?|acc(ount)?\s*no\.?|a\/c|customer\s+(code|account)|client\s+code|debtor\s+code)\s*[:#-]?\s*/i,
          ''
        )
        .replace(/\s+/g, '')
        .toUpperCase()
        .trim();

    return code || null;

  }

  // Everything else
  return String(
    value
  ).trim();

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

  let stringValue =
    String(value)
      .trim();

  if (!stringValue) {
    return null;
  }

  // Remove common currency symbols
  stringValue =
    stringValue.replace(
      /R\s?/gi,
      ''
    );

  stringValue =
    stringValue.replace(
      /\$/g,
      ''
    );

  stringValue =
    stringValue.replace(
      /€/g,
      ''
    );

  stringValue =
    stringValue.replace(
      /£/g,
      ''
    );

  // Remove spaces
  stringValue =
    stringValue.replace(
      /\s/g,
      ''
    );

  // Handle standard thousands separators
  stringValue =
    stringValue.replace(
      /,/g,
      ''
    );

  const parsed =
    Number(
      stringValue
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
  // FILE VALIDATION
  // -------------------------------------------------------------------------

  ensureFileExists(
    filePath
  );

  const effectiveMimeType =
    normalizeMimeType(
      mimeType,
      filePath
    );

  if (!effectiveMimeType) {

    throw new Error(
      'Unable to determine the uploaded invoice file type.'
    );

  }

  if (!isSupportedMimeType(effectiveMimeType)) {

    throw new Error(
      `Unsupported invoice file type: ${effectiveMimeType}`
    );

  }

  // -------------------------------------------------------------------------
  // GEMINI
  // -------------------------------------------------------------------------

  if (
    PROVIDER === 'gemini'
  ) {

    if (!GEMINI_API_KEY) {

      throw new Error(
        'AI_PROVIDER=gemini but GEMINI_API_KEY is missing from the server environment.'
      );

    }

    console.log(
      `[aiExtraction] Using Gemini ${GEMINI_MODEL}`
    );

    try {

      const extraction =
        await extractWithGemini(
          filePath,
          effectiveMimeType
        );

      console.log(
        '[aiExtraction] Gemini extraction successful.'
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
      // Do NOT create fake invoice data.
      // Do NOT return mock suppliers.
      // Do NOT silently hide the API failure.

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
        'AI_PROVIDER=claude but ANTHROPIC_API_KEY is missing from the server environment.'
      );

    }

    console.log(
      `[aiExtraction] Using Claude ${CLAUDE_MODEL}`
    );

    try {

      const extraction =
        await extractWithClaude(
          filePath,
          effectiveMimeType
        );

      console.log(
        '[aiExtraction] Claude extraction successful.'
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
      // Do NOT create fake invoice data.

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

// ===========================================================================
// GENERIC DOCUMENT EXTRACTION
//
// The invoice path above is one caller of the vision model, not the only one.
// This exposes the same provider plumbing — key handling, MIME normalization,
// base64 encoding, the request, and JSON recovery from a chatty response — for
// any document and any prompt, so a second document type does not need a
// second AI integration.
// ===========================================================================

/**
 * Sends a document to the configured vision model and returns parsed JSON.
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string} prompt - must instruct the model to return only JSON
 * @returns {Promise<{data: object, provider: string, model: string, raw: string}>}
 */
async function extractJsonFromDocument(filePath, mimeType, prompt) {

  ensureFileExists(filePath);

  const effectiveMimeType =
    normalizeMimeType(filePath ? mimeType : null, filePath);

  if (!effectiveMimeType) {
    throw new Error(
      'Unable to determine the document file type.'
    );
  }

  if (!isSupportedMimeType(effectiveMimeType)) {
    throw new Error(
      `Unsupported document file type: ${effectiveMimeType}`
    );
  }

  const base64 =
    fs.readFileSync(filePath).toString('base64');

  // -------------------------------------------------------------------------
  // GEMINI
  // -------------------------------------------------------------------------

  if (PROVIDER === 'gemini') {

    if (!GEMINI_API_KEY) {
      throw new Error(
        'AI_PROVIDER=gemini but GEMINI_API_KEY is missing from the server environment.'
      );
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        GEMINI_MODEL
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response =
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
                { text: prompt }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json'
          }
        })
      });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(
        `Gemini returned ${response.status}: ${detail.slice(0, 300)}`
      );
    }

    const payload = await response.json();

    const text =
      payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('') || '';

    if (!text.trim()) {
      throw new Error('Gemini returned an empty response.');
    }

    return {
      data: JSON.parse(cleanJsonResponse(text)),
      provider: 'gemini',
      model: GEMINI_MODEL,
      raw: text
    };
  }

  // -------------------------------------------------------------------------
  // CLAUDE
  // -------------------------------------------------------------------------

  if (PROVIDER === 'claude') {

    if (!CLAUDE_API_KEY) {
      throw new Error(
        'AI_PROVIDER=claude but ANTHROPIC_API_KEY is missing from the server environment.'
      );
    }

    // Claude takes a PDF as a document block and everything else as an image.
    const isPdf = effectiveMimeType === 'application/pdf';

    const response =
      await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 8000,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: isPdf ? 'document' : 'image',
                  source: {
                    type: 'base64',
                    media_type: effectiveMimeType,
                    data: base64
                  }
                },
                { type: 'text', text: prompt }
              ]
            }
          ]
        })
      });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(
        `Claude returned ${response.status}: ${detail.slice(0, 300)}`
      );
    }

    const payload = await response.json();

    const text =
      (payload?.content || [])
        .map((block) => block.text || '')
        .join('');

    if (!text.trim()) {
      throw new Error('Claude returned an empty response.');
    }

    return {
      data: JSON.parse(cleanJsonResponse(text)),
      provider: 'claude',
      model: CLAUDE_MODEL,
      raw: text
    };
  }

  throw new Error(
    `Unsupported AI_PROVIDER: "${PROVIDER}". Use "gemini" or "claude".`
  );
}

/**
 * Which provider is configured, and whether it can actually be called.
 */
function providerStatus() {
  return {
    provider: PROVIDER,
    configured:
      PROVIDER === 'gemini'
        ? Boolean(GEMINI_API_KEY)
        : PROVIDER === 'claude'
          ? Boolean(CLAUDE_API_KEY)
          : false,
    model:
      PROVIDER === 'gemini'
        ? GEMINI_MODEL
        : PROVIDER === 'claude'
          ? CLAUDE_MODEL
          : null
  };
}

module.exports = {

  extractInvoice,

  REQUIRED_FIELDS,

  extractJsonFromDocument,

  providerStatus

};
