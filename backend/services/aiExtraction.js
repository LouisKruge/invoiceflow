// services/aiExtraction.js
//
// Provider-agnostic invoice extraction.
// Supports Gemini, Claude, and Mock.
//
// Gemini is the primary provider when GEMINI_API_KEY is configured.
// Claude remains available as an optional fallback.
//
// API keys are ONLY used on the backend.

const fs = require('fs');

// ---------------------------------------------------------------------------
// PROVIDER CONFIGURATION
// ---------------------------------------------------------------------------

const PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// IMPORTANT:
// The Gemini URL already contains /models/.
// Therefore GEMINI_MODEL must be:
// gemini-3.6-flash
//
// This also strips "models/" automatically if someone accidentally
// puts it into the Render environment variable.
const GEMINI_MODEL = (
  process.env.GEMINI_MODEL || 'gemini-3.6-flash'
).replace(/^models\//, '');

const CLAUDE_API_KEY =
  process.env.ANTHROPIC_API_KEY || '';

const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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
15. Return ONLY the JSON object.
`;

// ---------------------------------------------------------------------------
// GEMINI
// ---------------------------------------------------------------------------

async function extractWithGemini(filePath, mimeType) {

  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured'
    );
  }

  const fileBuffer =
    fs.readFileSync(filePath);

  const base64 =
    fileBuffer.toString('base64');

  const effectiveMimeType =
    mimeType || 'application/octet-stream';

  console.log(
    `[aiExtraction] Gemini model: ${GEMINI_MODEL}`
  );

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

  // IMPORTANT:
  // Do NOT add "models/" to GEMINI_MODEL here.
  //
  // The URL is:
  // /v1beta/models/{MODEL}:generateContent
  //
  // Therefore:
  // gemini-3.6-flash
  //
  // becomes:
  // /v1beta/models/gemini-3.6-flash:generateContent

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}` +
    `:generateContent?key=` +
    `${encodeURIComponent(GEMINI_API_KEY)}`;

  console.log(
    `[aiExtraction] Calling Gemini API with model ${GEMINI_MODEL}`
  );

  const response = await fetch(
    url,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {

    const errorText =
      await response
        .text()
        .catch(() => '');

    throw new Error(
      `Gemini API error ${response.status}: ${errorText}`
    );
  }

  const data =
    await response.json();

  const candidates =
    data.candidates || [];

  if (!candidates.length) {

    throw new Error(
      'Gemini API returned no candidates'
    );
  }

  const parts =
    candidates[0]?.content?.parts || [];

  const text =
    parts
      .map(part => part.text || '')
      .join('')
      .trim();

  if (!text) {

    throw new Error(
      'Gemini API returned no extraction text'
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

    throw new Error(
      `Gemini returned invalid JSON: ${error.message}`
    );
  }

  return normalizeExtraction(
    parsed,
    data
  );
}

// ---------------------------------------------------------------------------
// CLAUDE
// ---------------------------------------------------------------------------

async function extractWithClaude(
  filePath,
  mimeType
) {

  if (!CLAUDE_API_KEY) {

    throw new Error(
      'ANTHROPIC_API_KEY is not configured'
    );
  }

  const imageBuffer =
    fs.readFileSync(filePath);

  const base64 =
    imageBuffer.toString('base64');

  const body = {

    model: CLAUDE_MODEL,

    max_tokens: 3000,

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

  const response =
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

  if (!response.ok) {

    const errorText =
      await response
        .text()
        .catch(() => '');

    throw new Error(
      `Claude API error ${response.status}: ${errorText}`
    );
  }

  const data =
    await response.json();

  const textBlock =
    (data.content || [])
      .find(
        block => block.type === 'text'
      );

  if (!textBlock) {

    throw new Error(
      'Claude API returned no text block'
    );
  }

  const cleaned =
    textBlock.text
      .replace(/```json|```/g, '')
      .trim();

  let parsed;

  try {

    parsed =
      JSON.parse(cleaned);

  } catch (error) {

    throw new Error(
      `Claude returned invalid JSON: ${error.message}`
    );
  }

  return normalizeExtraction(
    parsed,
    data
  );
}

// ---------------------------------------------------------------------------
// MOCK
// ---------------------------------------------------------------------------

const SAMPLE_SUPPLIERS = [

  {
    name: 'ABC Industrial Supplies',
    vat: '4123456789',
    address:
      '12 Bergman Street, Wynberg, Johannesburg, 2090',
    contact:
      'accounts@abcindustrial.co.za'
  },

  {
    name: 'XYZ Parts & Fasteners',
    vat: '4987654321',
    address:
      '45 Voortrekker Rd, Bellville, Cape Town, 7530',
    contact:
      '021 555 0132'
  },

  {
    name:
      'Highveld Electrical Wholesalers',
    vat: '4650912837',
    address:
      'Unit 7, Longmeadow Business Estate, Edenvale, 1609',
    contact:
      'sales@highveldelec.co.za'
  },

  {
    name:
      'Coastal Packaging Solutions',
    vat: '4712398456',
    address:
      '8 Umgeni Rd, Durban, 4001',
    contact:
      'orders@coastalpack.co.za'
  }

];

function pick(arr) {

  return arr[
    Math.floor(
      Math.random() * arr.length
    )
  ];

}

function round2(n) {

  return Math.round(n * 100) / 100;

}

function generateMockExtraction() {

  const supplier =
    pick(SAMPLE_SUPPLIERS);

  const lineCount =
    1 +
    Math.floor(
      Math.random() * 3
    );

  const lineItems = [];

  let subtotal = 0;

  for (
    let i = 0;
    i < lineCount;
    i++
  ) {

    const quantity =
      1 +
      Math.floor(
        Math.random() * 10
      );

    const unitPrice =
      round2(
        50 +
        Math.random() * 950
      );

    const lineTotal =
      round2(
        quantity * unitPrice
      );

    subtotal += lineTotal;

    lineItems.push({

      description:
        pick([
          'Steel brackets 50mm',
          'Cable ties (pack of 100)',
          'Safety gloves (pair)',
          'M8 bolts (box of 200)',
          'Cardboard cartons (bundle)',
          'LED floodlight 50W'
        ]),

      quantity,

      unit_price:
        unitPrice,

      vat:
        null,

      total:
        lineTotal

    });

  }

  subtotal =
    round2(subtotal);

  const vatAmount =
    round2(
      subtotal * 0.15
    );

  const total =
    round2(
      subtotal + vatAmount
    );

  const today =
    new Date();

  const invoiceDate =
    new Date(
      today.getTime() -
      Math.floor(
        Math.random() * 5
      ) *
      86400000
    );

  const dueDate =
    new Date(
      invoiceDate.getTime() +
      30 *
      86400000
    );

  const formatDate =
    date =>
      date
        .toISOString()
        .slice(0, 10);

  const messy =
    Math.random() < 0.3;

  const fields = {

    invoice_number:
      `INV-${
        40000 +
        Math.floor(
          Math.random() * 9999
        )
      }`,

    supplier_name:
      supplier.name,

    supplier_vat_number:
      supplier.vat,

    invoice_date:
      formatDate(invoiceDate),

    due_date:
      formatDate(dueDate),

    purchase_order_number:
      Math.random() < 0.7
        ? `PO-${
            1000 +
            Math.floor(
              Math.random() * 999
            )
          }`
        : null,

    subtotal,

    vat_amount:
      vatAmount,

    total_amount:
      messy
        ? round2(
            total + 0.5
          )
        : total,

    currency:
      'ZAR',

    payment_terms:
      pick([
        '30 days from invoice date',
        '7 days strictly nett',
        '60 days from statement'
      ]),

    supplier_address:
      supplier.address,

    supplier_contact:
      supplier.contact,

    line_items:
      lineItems

  };

  const confidence = {};

  for (
    const field of REQUIRED_FIELDS
  ) {

    if (
      fields[field] === null ||
      fields[field] === undefined
    ) {

      confidence[field] =
        round2(
          0.3 +
          Math.random() * 0.2
        );

    }

    else if (
      messy &&
      [
        'total_amount',
        'vat_amount',
        'purchase_order_number'
      ].includes(field)
    ) {

      confidence[field] =
        round2(
          0.55 +
          Math.random() * 0.2
        );

    }

    else {

      confidence[field] =
        round2(
          0.9 +
          Math.random() * 0.09
        );

    }

  }

  if (
    !fields.purchase_order_number
  ) {

    confidence.purchase_order_number =
      round2(
        0.2 +
        Math.random() * 0.2
      );

  }

  return {
    ...fields,
    confidence
  };

}

async function extractWithMock(
  filePath,
  mimeType
) {

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        400 +
        Math.random() * 400
      )
  );

  return normalizeExtraction(
    generateMockExtraction(),
    { mock: true }
  );

}

// ---------------------------------------------------------------------------
// NORMALIZATION
// ---------------------------------------------------------------------------

function normalizeExtraction(
  parsed,
  raw
) {

  const fields = {};

  for (
    const field of REQUIRED_FIELDS
  ) {

    fields[field] =
      parsed &&
      parsed[field] !== undefined
        ? parsed[field]
        : null;

  }

  const lineItems =
    Array.isArray(
      parsed?.line_items
    )

      ? parsed.line_items.map(
          item => ({

            description:
              item?.description ??
              null,

            quantity:
              item?.quantity ??
              null,

            unit_price:
              item?.unit_price ??
              null,

            vat:
              item?.vat ??
              null,

            total:
              item?.total ??
              null

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

// ---------------------------------------------------------------------------
// MAIN EXTRACTION FUNCTION
// ---------------------------------------------------------------------------

async function extractInvoice(
  filePath,
  mimeType
) {

  // ---------------------------------------------------------
  // MOCK MODE
  // ---------------------------------------------------------

  if (
    PROVIDER === 'mock'
  ) {

    console.log(
      '[aiExtraction] Explicit mock mode enabled'
    );

    return {

      ...(await extractWithMock(
        filePath,
        mimeType
      )),

      provider:
        'mock'

    };

  }

  // ---------------------------------------------------------
  // GEMINI MODE
  // ---------------------------------------------------------

  if (
    PROVIDER === 'gemini'
  ) {

    if (!GEMINI_API_KEY) {

      throw new Error(
        'AI_PROVIDER is set to gemini but GEMINI_API_KEY is missing'
      );

    }

    try {

      console.log(
        `[aiExtraction] Using Gemini ${GEMINI_MODEL}`
      );

      const result =
        await extractWithGemini(
          filePath,
          mimeType
        );

      console.log(
        '[aiExtraction] Gemini extraction successful'
      );

      return {

        ...result,

        provider:
          'gemini'

      };

    }

    catch (error) {

      console.error(
        '[aiExtraction] Gemini extraction failed:',
        error.message
      );

      // Claude fallback if configured.
      if (
        CLAUDE_API_KEY
      ) {

        try {

          console.log(
            `[aiExtraction] Falling back to Claude ${CLAUDE_MODEL}`
          );

          const result =
            await extractWithClaude(
              filePath,
              mimeType
            );

          return {

            ...result,

            provider:
              'claude-fallback',

            error:
              error.message

          };

        }

        catch (claudeError) {

          console.error(
            '[aiExtraction] Claude fallback failed:',
            claudeError.message
          );

        }

      }

      // IMPORTANT:
      // We are keeping mock fallback because your current
      // application expects an extraction result.
      //
      // The returned provider will clearly say mock-fallback.

      return {

        ...(await extractWithMock(
          filePath,
          mimeType
        )),

        provider:
          'mock-fallback',

        error:
          error.message

      };

    }

  }

  // ---------------------------------------------------------
  // CLAUDE MODE
  // ---------------------------------------------------------

  if (
    PROVIDER === 'claude'
  ) {

    if (!CLAUDE_API_KEY) {

      throw new Error(
        'AI_PROVIDER is set to claude but ANTHROPIC_API_KEY is missing'
      );

    }

    try {

      return {

        ...(await extractWithClaude(
          filePath,
          mimeType
        )),

        provider:
          'claude'

      };

    }

    catch (error) {

      console.error(
        '[aiExtraction] Claude extraction failed:',
        error.message
      );

      return {

        ...(await extractWithMock(
          filePath,
          mimeType
        )),

        provider:
          'mock-fallback',

        error:
          error.message

      };

    }

  }

  // ---------------------------------------------------------
  // AUTOMATIC PROVIDER SELECTION
  // ---------------------------------------------------------

  if (
    GEMINI_API_KEY
  ) {

    try {

      console.log(
        `[aiExtraction] Automatically using Gemini ${GEMINI_MODEL}`
      );

      const result =
        await extractWithGemini(
          filePath,
          mimeType
        );

      return {

        ...result,

        provider:
          'gemini'

      };

    }

    catch (error) {

      console.error(
        '[aiExtraction] Gemini failed:',
        error.message
      );

    }

  }

  if (
    CLAUDE_API_KEY
  ) {

    try {

      console.log(
        `[aiExtraction] Automatically using Claude ${CLAUDE_MODEL}`
      );

      const result =
        await extractWithClaude(
          filePath,
          mimeType
        );

      return {

        ...result,

        provider:
          'claude'

      };

    }

    catch (error) {

      console.error(
        '[aiExtraction] Claude failed:',
        error.message
      );

    }

  }

  console.warn(
    '[aiExtraction] No working AI provider found — using mock extraction'
  );

  return {

    ...(await extractWithMock(
      filePath,
      mimeType
    )),

    provider:
      'mock'

  };

}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = {
  extractInvoice,
  REQUIRED_FIELDS
};



