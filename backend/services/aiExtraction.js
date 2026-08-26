// services/aiExtraction.js
//
// Provider-agnostic invoice extraction. Exposes a single function,
// extractInvoice(filePath, mimeType), which returns:
//   { fields: {...}, lineItems: [...], confidence: {...}, raw: {...} }
//
// Swapping providers: implement a new `extractWith<Provider>()` function with
// the same return shape and select it in `extractInvoice()`. Nothing else in
// the app (routes/validation/db) needs to know which provider is in use.
// services/aiExtraction.js
//
// Provider-agnostic invoice extraction.
// Supports Gemini, Claude, and Mock providers.
//
// extractInvoice(filePath, mimeType) returns:
//   {
//     fields: {...},
//     lineItems: [...],
//     confidence: {...},
//     raw: {...},
//     provider: 'gemini' | 'claude' | 'mock' | 'mock-fallback',
//     error?: string
//   }

const fs = require('fs');

// ---------------------------------------------------------------------------
// PROVIDER CONFIGURATION
// ---------------------------------------------------------------------------

const PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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
4. Confidence should represent how clearly and reliably the value was read from the document.
5. Dates must use YYYY-MM-DD where possible.
6. Numbers must be plain numbers without currency symbols or thousands separators.
7. Do not assume a VAT rate.
8. Only report VAT if it is printed or can be unambiguously calculated from the invoice.
9. Currency should use ISO 4217 codes such as ZAR, USD, GBP or EUR.
10. For a South African invoice with clear R/ZAR indicators, use ZAR.
11. Extract every visible invoice line item.
12. Do not create line items that are not present.
13. Preserve supplier names and invoice numbers exactly as printed where possible.
14. If the invoice contains an order/purchase number, extract it as purchase_order_number.
15. Return ONLY the JSON object.
`;

// ---------------------------------------------------------------------------
// GEMINI PROVIDER
// ---------------------------------------------------------------------------

async function extractWithGemini(filePath, mimeType) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');

  // Gemini's API accepts application/pdf directly, so preserve the
  // original MIME type instead of converting PDFs to image/jpeg.
  const effectiveMimeType = mimeType || 'application/octet-stream';

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

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');

    throw new Error(
      `Gemini API error ${resp.status}: ${text}`
    );
  }

  const data = await resp.json();

  const candidates = data.candidates || [];

  if (!candidates.length) {
    throw new Error('Gemini API returned no candidates');
  }

  const parts = candidates[0]?.content?.parts || [];

  const text = parts
    .map(part => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini API returned no extraction text');
  }

  let cleaned = text;

  // Defensive cleanup in case the model returns markdown fences despite
  // responseMimeType=json.
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed;

  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Gemini returned invalid JSON: ${err.message}`
    );
  }

  return normalizeExtraction(parsed, data);
}

// ---------------------------------------------------------------------------
// CLAUDE PROVIDER
// ---------------------------------------------------------------------------

async function extractWithClaude(filePath, mimeType) {
  if (!CLAUDE_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system: EXTRACTION_SYSTEM_PROMPT,
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
            text: 'Extract this invoice as the specified JSON object. Return only JSON.'
          }
        ]
      }
    ]
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');

    throw new Error(
      `Claude API error ${resp.status}: ${text}`
    );
  }

  const data = await resp.json();

  const textBlock = (data.content || [])
    .find(block => block.type === 'text');

  if (!textBlock) {
    throw new Error('Claude API returned no text block');
  }

  const cleaned = textBlock.text
    .replace(/```json|```/g, '')
    .trim();

  let parsed;

  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Claude returned invalid JSON: ${err.message}`
    );
  }

  return normalizeExtraction(parsed, data);
}

// ---------------------------------------------------------------------------
// MOCK PROVIDER
// ---------------------------------------------------------------------------
//
// Used when explicitly configured as AI_PROVIDER=mock.
// Also used as a final fallback if a configured live provider fails.
//
// ---------------------------------------------------------------------------

const SAMPLE_SUPPLIERS = [
  {
    name: 'ABC Industrial Supplies',
    vat: '4123456789',
    address: '12 Bergman Street, Wynberg, Johannesburg, 2090',
    contact: 'accounts@abcindustrial.co.za'
  },
  {
    name: 'XYZ Parts & Fasteners',
    vat: '4987654321',
    address: '45 Voortrekker Rd, Bellville, Cape Town, 7530',
    contact: '021 555 0132'
  },
  {
    name: 'Highveld Electrical Wholesalers',
    vat: '4650912837',
    address: 'Unit 7, Longmeadow Business Estate, Edenvale, 1609',
    contact: 'sales@highveldelec.co.za'
  },
  {
    name: 'Coastal Packaging Solutions',
    vat: '4712398456',
    address: '8 Umgeni Rd, Durban, 4001',
    contact: 'orders@coastalpack.co.za'
  }
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function generateMockExtraction() {
  const supplier = pick(SAMPLE_SUPPLIERS);

  const lineCount = 1 + Math.floor(Math.random() * 3);

  const lineItems = [];

  let subtotal = 0;

  for (let i = 0; i < lineCount; i++) {
    const qty = 1 + Math.floor(Math.random() * 10);

    const unitPrice = round2(
      50 + Math.random() * 950
    );

    const lineTotal = round2(
      qty * unitPrice
    );

    subtotal += lineTotal;

    lineItems.push({
      description: pick([
        'Steel brackets 50mm',
        'Cable ties (pack of 100)',
        'Safety gloves (pair)',
        'M8 bolts (box of 200)',
        'Cardboard cartons (bundle)',
        'LED floodlight 50W'
      ]),
      quantity: qty,
      unit_price: unitPrice,
      vat: null,
      total: lineTotal
    });
  }

  subtotal = round2(subtotal);

  const vatAmount = round2(
    subtotal * 0.15
  );

  const total = round2(
    subtotal + vatAmount
  );

  const today = new Date();

  const invDate = new Date(
    today.getTime() -
    Math.floor(Math.random() * 5) * 86400000
  );

  const dueDate = new Date(
    invDate.getTime() +
    30 * 86400000
  );

  const fmt = d =>
    d.toISOString().slice(0, 10);

  const messy = Math.random() < 0.3;

  const fields = {
    invoice_number:
      `INV-${40000 + Math.floor(Math.random() * 9999)}`,

    supplier_name:
      supplier.name,

    supplier_vat_number:
      supplier.vat,

    invoice_date:
      fmt(invDate),

    due_date:
      fmt(dueDate),

    purchase_order_number:
      Math.random() < 0.7
        ? `PO-${1000 + Math.floor(Math.random() * 999)}`
        : null,

    subtotal,

    vat_amount:
      vatAmount,

    total_amount:
      messy
        ? round2(total + 0.5)
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

  for (const f of REQUIRED_FIELDS) {
    if (
      fields[f] === null ||
      fields[f] === undefined
    ) {
      confidence[f] =
        round2(0.3 + Math.random() * 0.2);
    } else if (
      messy &&
      [
        'total_amount',
        'vat_amount',
        'purchase_order_number'
      ].includes(f)
    ) {
      confidence[f] =
        round2(0.55 + Math.random() * 0.2);
    } else {
      confidence[f] =
        round2(0.9 + Math.random() * 0.09);
    }
  }

  if (!fields.purchase_order_number) {
    confidence.purchase_order_number =
      round2(0.2 + Math.random() * 0.2);
  }

  return {
    ...fields,
    confidence
  };
}

async function extractWithMock(filePath, mimeType) {
  await new Promise(resolve =>
    setTimeout(
      resolve,
      400 + Math.random() * 400
    )
  );

  const parsed =
    generateMockExtraction();

  return normalizeExtraction(
    parsed,
    { mock: true }
  );
}

// ---------------------------------------------------------------------------
// NORMALIZATION
// ---------------------------------------------------------------------------

function normalizeExtraction(parsed, raw) {
  const fields = {};

  for (const f of REQUIRED_FIELDS) {
    fields[f] =
      parsed && parsed[f] !== undefined
        ? parsed[f]
        : null;
  }

  const lineItems =
    Array.isArray(parsed?.line_items)
      ? parsed.line_items.map(li => ({
          description:
            li?.description ?? null,

          quantity:
            li?.quantity ?? null,

          unit_price:
            li?.unit_price ?? null,

          vat:
            li?.vat ?? null,

          total:
            li?.total ?? null
        }))
      : [];

  const confidence = {};

  for (const f of REQUIRED_FIELDS) {
    const value =
      parsed?.confidence?.[f];

    confidence[f] =
      typeof value === 'number'
        ? Math.max(0, Math.min(1, value))
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

async function extractInvoice(filePath, mimeType) {

  // ---------------------------------------------------------
  // EXPLICIT MOCK
  // ---------------------------------------------------------

  if (PROVIDER === 'mock') {
    return {
      ...(await extractWithMock(
        filePath,
        mimeType
      )),
      provider: 'mock'
    };
  }

  // ---------------------------------------------------------
  // EXPLICIT CLAUDE
  // ---------------------------------------------------------

  if (PROVIDER === 'claude') {
    if (!CLAUDE_API_KEY) {
      console.warn(
        '[aiExtraction] AI_PROVIDER=claude but ANTHROPIC_API_KEY is missing'
      );

      return {
        ...(await extractWithMock(
          filePath,
          mimeType
        )),
        provider: 'mock-fallback',
        error: 'ANTHROPIC_API_KEY is not configured'
      };
    }

    try {
      return {
        ...(await extractWithClaude(
          filePath,
          mimeType
        )),
        provider: 'claude'
      };
    } catch (err) {
      console.error(
        '[aiExtraction] Claude extraction failed:',
        err.message
      );

      return {
        ...(await extractWithMock(
          filePath,
          mimeType
        )),
        provider: 'mock-fallback',
        error: err.message
      };
    }
  }

  // ---------------------------------------------------------
  // EXPLICIT GEMINI
  // ---------------------------------------------------------

  if (PROVIDER === 'gemini') {
    if (!GEMINI_API_KEY) {
      console.warn(
        '[aiExtraction] AI_PROVIDER=gemini but GEMINI_API_KEY is missing'
      );

      return {
        ...(await extractWithMock(
          filePath,
          mimeType
        )),
        provider: 'mock-fallback',
        error: 'GEMINI_API_KEY is not configured'
      };
    }

    try {
      return {
        ...(await extractWithGemini(
          filePath,
          mimeType
        )),
        provider: 'gemini'
      };
    } catch (err) {
      console.error(
        '[aiExtraction] Gemini extraction failed:',
        err.message
      );

      return {
        ...(await extractWithMock(
          filePath,
          mimeType
        )),
        provider: 'mock-fallback',
        error: err.message
      };
    }
  }

  // ---------------------------------------------------------
  // AUTOMATIC PROVIDER SELECTION
  // ---------------------------------------------------------
  //
  // If AI_PROVIDER isn't set:
  // Gemini → Claude → Mock
  //
  // This means simply having GEMINI_API_KEY in Render is enough
  // to use Gemini even if AI_PROVIDER hasn't been configured.
  // ---------------------------------------------------------

  if (GEMINI_API_KEY) {
    try {
      console.log(
        `[aiExtraction] Using Gemini (${GEMINI_MODEL})`
      );

      return {
        ...(await extractWithGemini(
          filePath,
          mimeType
        )),
        provider: 'gemini'
      };
    } catch (err) {
      console.error(
        '[aiExtraction] Gemini extraction failed:',
        err.message
      );

      // Try Claude if configured.
      if (CLAUDE_API_KEY) {
        try {
          console.log(
            `[aiExtraction] Falling back to Claude (${CLAUDE_MODEL})`
          );

          return {
            ...(await extractWithClaude(
              filePath,
              mimeType
            )),
            provider: 'claude-fallback',
            error: err.message
          };
        } catch (claudeErr) {
          console.error(
            '[aiExtraction] Claude fallback failed:',
            claudeErr.message
          );
        }
      }

      return {
        ...(await extractWithMock(
          filePath,
          mimeType
        )),
        provider: 'mock-fallback',
        error: err.message
      };
    }
  }

  // ---------------------------------------------------------
  // CLAUDE AUTOMATIC FALLBACK
  // ---------------------------------------------------------

  if (CLAUDE_API_KEY) {
    try {
      console.log(
        `[aiExtraction] Using Claude (${CLAUDE_MODEL})`
      );

      return {
        ...(await extractWithClaude(
          filePath,
          mimeType
        )),
        provider: 'claude'
      };
    } catch (err) {
      console.error(
        '[aiExtraction] Claude extraction failed:',
        err.message
      );

      return {
        ...(await extractWithMock(
          filePath,
          mimeType
        )),
        provider: 'mock-fallback',
        error: err.message
      };
    }
  }

  // ---------------------------------------------------------
  // NO AI PROVIDER
  // ---------------------------------------------------------

  console.warn(
    '[aiExtraction] No AI API key configured — using mock extraction'
  );

  return {
    ...(await extractWithMock(
      filePath,
      mimeType
    )),
    provider: 'mock'
  };
}

module.exports = {
  extractInvoice,
  REQUIRED_FIELDS
};



