// services/aiExtraction.js
//
// Provider-agnostic invoice extraction. Exposes a single function,
// extractInvoice(filePath, mimeType), which returns:
//   { fields: {...}, lineItems: [...], confidence: {...}, raw: {...} }
//
// Swapping providers: implement a new `extractWith<Provider>()` function with
// the same return shape and select it in `extractInvoice()`. Nothing else in
// the app (routes/validation/db) needs to know which provider is in use.

const fs = require('fs');

const PROVIDER = process.env.AI_PROVIDER || 'claude';
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const REQUIRED_FIELDS = [
  'invoice_number', 'supplier_name', 'supplier_vat_number', 'invoice_date',
  'due_date', 'purchase_order_number', 'subtotal', 'vat_amount', 'total_amount',
  'currency', 'payment_terms', 'supplier_address', 'supplier_contact'
];

const EXTRACTION_SYSTEM_PROMPT = `You are an invoice data extraction engine for a South African accounts-payable system.
You will be given an image of a physical invoice. Extract the following fields as strict JSON, with no
markdown fences and no commentary:

{
  "invoice_number": string|null,
  "supplier_name": string|null,
  "supplier_vat_number": string|null,
  "invoice_date": string|null,       // ISO 8601 (YYYY-MM-DD)
  "due_date": string|null,           // ISO 8601 (YYYY-MM-DD)
  "purchase_order_number": string|null,
  "subtotal": number|null,
  "vat_amount": number|null,
  "total_amount": number|null,
  "currency": string|null,           // ISO 4217, default "ZAR" if a South African invoice with no symbol
  "payment_terms": string|null,
  "supplier_address": string|null,
  "supplier_contact": string|null,
  "line_items": [
    { "description": string, "quantity": number|null, "unit_price": number|null, "vat": number|null, "total": number|null }
  ],
  "confidence": {
    // one 0.0-1.0 value per top-level field above (not line_items), reflecting how
    // confident you are that the extracted value is correct and legible
  }
}

Rules:
- Never invent or guess a value. If a field is not clearly present or legible, set it to null and give it a low confidence score.
- Numbers must be plain numbers (no currency symbols, no thousands separators).
- Do not assume a VAT rate. Only report vat_amount/subtotal/total as printed or unambiguously derivable from what is printed.
- Return ONLY the JSON object.`;

async function extractWithClaude(filePath, mimeType) {
  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: 'Extract this invoice as the specified JSON object. Return only JSON.' }
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
    throw new Error(`Claude API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude API returned no text block');

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return normalizeExtraction(parsed, data);
}

// ---------------------------------------------------------------------------
// Mock provider — used automatically when ANTHROPIC_API_KEY is not configured,
// or when AI_PROVIDER=mock. Returns realistic, varied sample extractions so
// the full workflow (confidence flags, validation, review, approval, export)
// can be demonstrated end-to-end without a live API key.
// ---------------------------------------------------------------------------

const SAMPLE_SUPPLIERS = [
  { name: 'ABC Industrial Supplies', vat: '4123456789', address: '12 Bergman Street, Wynberg, Johannesburg, 2090', contact: 'accounts@abcindustrial.co.za' },
  { name: 'XYZ Parts & Fasteners', vat: '4987654321', address: '45 Voortrekker Rd, Bellville, Cape Town, 7530', contact: '021 555 0132' },
  { name: 'Highveld Electrical Wholesalers', vat: '4650912837', address: 'Unit 7, Longmeadow Business Estate, Edenvale, 1609', contact: 'sales@highveldelec.co.za' },
  { name: 'Coastal Packaging Solutions', vat: '4712398456', address: '8 Umgeni Rd, Durban, 4001', contact: 'orders@coastalpack.co.za' },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function round2(n) { return Math.round(n * 100) / 100; }

function generateMockExtraction() {
  const supplier = pick(SAMPLE_SUPPLIERS);
  const lineCount = 1 + Math.floor(Math.random() * 3);
  const lineItems = [];
  let subtotal = 0;
  for (let i = 0; i < lineCount; i++) {
    const qty = 1 + Math.floor(Math.random() * 10);
    const unitPrice = round2(50 + Math.random() * 950);
    const lineTotal = round2(qty * unitPrice);
    subtotal += lineTotal;
    lineItems.push({
      description: pick(['Steel brackets 50mm', 'Cable ties (pack of 100)', 'Safety gloves (pair)', 'M8 bolts (box of 200)', 'Cardboard cartons (bundle)', 'LED floodlight 50W']),
      quantity: qty, unit_price: unitPrice, vat: null, total: lineTotal
    });
  }
  subtotal = round2(subtotal);
  const vatAmount = round2(subtotal * 0.15);
  const total = round2(subtotal + vatAmount);

  const today = new Date();
  const invDate = new Date(today.getTime() - Math.floor(Math.random() * 5) * 86400000);
  const dueDate = new Date(invDate.getTime() + 30 * 86400000);
  const fmt = d => d.toISOString().slice(0, 10);

  // Occasionally simulate a low-confidence / messy scan so the UI has
  // something realistic to flag for review.
  const messy = Math.random() < 0.3;

  const fields = {
    invoice_number: `INV-${40000 + Math.floor(Math.random() * 9999)}`,
    supplier_name: supplier.name,
    supplier_vat_number: supplier.vat,
    invoice_date: fmt(invDate),
    due_date: fmt(dueDate),
    purchase_order_number: Math.random() < 0.7 ? `PO-${1000 + Math.floor(Math.random() * 999)}` : null,
    subtotal,
    vat_amount: vatAmount,
    total_amount: messy ? round2(total + 0.5) : total, // introduce a small mismatch sometimes
    currency: 'ZAR',
    payment_terms: pick(['30 days from invoice date', '7 days strictly nett', '60 days from statement']),
    supplier_address: supplier.address,
    supplier_contact: supplier.contact,
    line_items: lineItems,
  };

  const confidence = {};
  for (const f of REQUIRED_FIELDS) {
    if (fields[f] === null || fields[f] === undefined) {
      confidence[f] = round2(0.3 + Math.random() * 0.2);
    } else if (messy && ['total_amount', 'vat_amount', 'purchase_order_number'].includes(f)) {
      confidence[f] = round2(0.55 + Math.random() * 0.2);
    } else {
      confidence[f] = round2(0.9 + Math.random() * 0.09);
    }
  }
  if (!fields.purchase_order_number) confidence.purchase_order_number = round2(0.2 + Math.random() * 0.2);

  return { ...fields, confidence };
}

async function extractWithMock(filePath, mimeType) {
  await new Promise(res => setTimeout(res, 400 + Math.random() * 400)); // simulate latency
  const parsed = generateMockExtraction();
  return normalizeExtraction(parsed, { mock: true });
}

function normalizeExtraction(parsed, raw) {
  const fields = {};
  for (const f of REQUIRED_FIELDS) fields[f] = parsed[f] ?? null;
  const lineItems = Array.isArray(parsed.line_items) ? parsed.line_items.map(li => ({
    description: li.description ?? null,
    quantity: li.quantity ?? null,
    unit_price: li.unit_price ?? null,
    vat: li.vat ?? null,
    total: li.total ?? null,
  })) : [];
  const confidence = {};
  for (const f of REQUIRED_FIELDS) confidence[f] = typeof parsed.confidence?.[f] === 'number' ? parsed.confidence[f] : null;

  return { fields, lineItems, confidence, raw };
}

async function extractInvoice(filePath, mimeType) {
  const useMock = PROVIDER === 'mock' || !CLAUDE_API_KEY;
  if (useMock) {
    return { ...(await extractWithMock(filePath, mimeType)), provider: 'mock' };
  }
  try {
    return { ...(await extractWithClaude(filePath, mimeType)), provider: 'claude' };
  } catch (err) {
    console.error('[aiExtraction] Claude extraction failed, falling back to mock:', err.message);
    return { ...(await extractWithMock(filePath, mimeType)), provider: 'mock-fallback', error: err.message };
  }
}

module.exports = { extractInvoice, REQUIRED_FIELDS };
