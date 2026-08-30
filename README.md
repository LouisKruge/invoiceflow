# InvoiceFlow

Paper documents become validated, auditable data.

An invoice is photographed, read by AI, checked, approved, and exported. A stock sign-out sheet is
uploaded, read, matched against the product master, and — once a person approves it — deducted from
stock. Everything that moves inventory goes through one ledger, so the quantity on screen can always be
explained by the movements behind it.

Express 5 + PostgreSQL backend, vanilla-JS frontend with no build step.

---

## 1. Running it

Requires Node.js 20+ and a PostgreSQL database.

### Plain Node

```bash
cd backend
cp .env.example .env      # set DATABASE_URL and JWT_SECRET
npm install
npm start
```

Open **http://localhost:4000**. The schema is created and migrated on every boot, so a new database
needs no migration step.

There is no demo data and there are no default accounts. The first person to register becomes the
administrator; everyone who registers after that starts as a processor, and an administrator can change
their role. To create that first account without a browser, set `ADMIN_NAME`, `ADMIN_EMAIL` and
`ADMIN_PASSWORD` and run `node seed.js`.

**Camera capture needs HTTPS** (or `localhost`) — browsers block `getUserMedia` on a plain `http://`
address. For a phone test on your own network, a tunnel is the quickest way to get TLS:

```bash
npx localtunnel --port 4000
```

### Docker

```bash
docker compose up -d --build
```

Brings up PostgreSQL and the app together on port 4000. Uploaded documents live in the
`invoiceflow-data` volume and the database in `invoiceflow-db`, so both survive a restart. Set real
values in a `.env` file next to `docker-compose.yml` before anyone else uses it — at minimum
`JWT_SECRET`.

To run against a database you already have, set `DATABASE_URL` and the `postgres` service is unused.

> The image builds Node 20 and installs from the lockfile — nothing compiles native code, and
> `npm ci --omit=dev` was verified against this lockfile. The build itself has not been run here (this
> sandbox has the Docker client but no daemon), so give `docker compose up --build` one local run before
> relying on it.

### Render / Railway / Fly.io

1. Point a Web Service at this repository.
2. Build: `cd backend && npm install`. Start: `node backend/server.js` (a `Procfile` is included).
3. Set `DATABASE_URL` and `JWT_SECRET`, plus `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` for live
   extraction. See `backend/.env.example` for everything that can be set.
4. **Attach a disk at `backend/data`.** The database holds the path to each uploaded document, not the
   document itself, so on an ephemeral filesystem the records survive a redeploy but the images do not.

---

## 2. AI extraction

`AI_PROVIDER` selects `gemini` (default), `claude`, or `mock`. With no key configured the app falls back
to the mock extractor rather than failing, and the interface says which provider read a document.

The same extraction path serves both invoices and stock sign-out sheets: `services/aiExtraction.js`
exposes `extractInvoice()` for invoices and `extractJsonFromDocument()` for anything else that needs a
document turned into JSON. Swapping in another vision provider means writing one function there; routes,
validation and the database are untouched.

A failed extraction is never silent. The invoice becomes a visible exception with a retry path, and a
sign-out sheet is marked `FAILED` with the reason — and, in both cases, nothing is written to stock.

---

## 3. What it does

### Invoices

- Capture with the phone camera (guide frame, brightness warning) or upload a JPG/PNG/WEBP/PDF
- AI extraction with per-field confidence, including the supplier account code (e.g. `EVE001`)
- Validation: subtotal + VAT = total, duplicate detection, missing fields, VAT-rate sanity
- Review screen with inline editing that re-validates on save, then approve or reject
- Delete from the dashboard, the list, or the invoice itself (single or bulk, admin/reviewer only)
- Full audit trail per invoice — uploaded → extracted → validated → edited → approved, with who and when
- Search and filter across number, supplier, VAT number, PO number, account code and amount
- Excel export: everything, a selection, or a date range, with a line-items sheet
- Suppliers built from what has been captured, and spend reporting over them

### Stock

- **Product master** with a canonical product ID — descriptions differ between documents, IDs do not
- **Bin numbers**: imported from the stock spreadsheet, shown on every product, and able to identify a
  product on their own, because a sign-out sheet often records nothing else. A product may occupy
  several bins and any of them resolves it; a bin holding two products is treated as ambiguous rather
  than guessed at
- **Update-only import** for filling a field in on a master that already exists — bins, costs,
  categories — which creates no products and posts no quantities whatever the mapping says
- **Import** an existing stock spreadsheet: columns are detected, you confirm the mapping, and each row
  becomes an `OPENING_BALANCE` transaction rather than a number typed into a table
- **Ledger** of every movement (`OPENING_BALANCE`, `PURCHASE_RECEIPT`, `STOCK_ISSUE`, `ADJUSTMENT`,
  `TRANSFER`, `RETURN`, `WRITE_OFF`). Current stock is derived from it and can be re-derived at any time
- **Approving an invoice** receipts its lines into stock automatically
- **Stock sign-out sheets** — a photo, PDF, Excel or CSV of what was taken out — are read, matched and
  validated, and deduct stock only once a person approves. Posting is all-or-nothing and idempotent:
  one unresolved line blocks the sheet, and approving twice deducts once
- **Review queue** for lines the matcher could not place confidently, and manual adjustments with a
  reason for everything else
- **Traceability**: a product's history lists every movement with a running balance, and each one links
  back to the invoice or sign-out sheet it came from — and to that document itself

Quantities are read, never guessed. "two" and "a dozen" resolve; "2/?" or anything illegible does not,
and goes to a person instead. The same applies to identity: a bin that holds one product resolves it, a
bin that holds two resolves nothing. Confidence never overrides a hard rule: a 99%-confident match on a product
that is not in the master is still rejected.

---

## 4. Architecture

Stock follows one direction, and nothing skips a step:

```
DOCUMENT → EXTRACTION → PRODUCT MATCH → VALIDATION → APPROVAL → LEDGER → CURRENT STOCK
```

`services/stockLedger.js` is the only writer of stock movements. It holds the negative-stock guard, the
balance cache, and the idempotency gate that makes posting a document twice a no-op. Nothing else writes
to `stock_transactions`, so those rules cannot be bypassed by adding a feature.

Transactions and products also carry `syspro_stock_code`, `syspro_warehouse`,
`syspro_transaction_reference`, `syspro_sync_status` and `syspro_sync_error`, so a later SYSPRO
integration has somewhere to record itself without a schema change.

### Layout

```
invoiceflow/
├── backend/
│   ├── server.js             entry point — also serves the frontend
│   ├── db.js                 PostgreSQL schema + idempotent migrations, run on every boot
│   ├── seed.js               optional first-administrator setup (no demo data)
│   ├── middleware/auth.js    JWT auth + role guard
│   ├── services/
│   │   ├── aiExtraction.js   Gemini/Claude vision, for invoices and any other document
│   │   ├── validation.js     math, duplicate, missing-field and VAT checks
│   │   ├── exportExcel.js    ExcelJS workbook builder
│   │   ├── stockLedger.js    the only writer of stock movements
│   │   ├── productMatching.js  code/barcode/description matching with confidence
│   │   ├── stockImport.js    spreadsheet reading and column mapping
│   │   ├── stockSheet.js     sign-out sheets: read → match → validate → post
│   │   └── invoiceStock.js   invoice approval → stock receipt
│   └── routes/
│       └── auth.js, invoices.js, dashboard.js, suppliers.js, export.js, stock.js
├── frontend/
│   ├── index.html
│   ├── css/styles.css        design tokens + stylesheet
│   └── js/
│       ├── api.js            fetch client
│       ├── camera.js         live capture + native picker fallback
│       ├── views.js          render functions (HTML string templates)
│       └── app.js            router, state, event wiring
├── Dockerfile / docker-compose.yml / Procfile
```

The frontend is four classic scripts loaded in order — no bundler, no build step. Editing a file and
reloading is the whole development loop.

---

## 5. Not built

Deliberately left out, with the schema ready so none of it needs a migration later:

- `purchase_orders` and `goods_received_notes` tables exist; PO matching logic does not
- Accounting/ERP integrations (Sage, Xero, QuickBooks, SYSPRO), email or WhatsApp intake
- Real document edge detection and auto-crop — capture has a guide frame and a brightness heuristic,
  not computer vision

---

## 6. Testing

Verified against real PostgreSQL and a real browser (Chromium via Playwright), not mocks: the API
suite covers every route including role gating and delete permissions; the stock suite imports a
spreadsheet, approves an invoice into stock and traces a product end to end; the sign-out suite covers
a printed sheet, an unreadable quantity, an unknown product, insufficient stock, the same sheet twice,
a multi-line sheet posting atomically, and a user correction being reused on the next document; and
jsdom suites render every view and drive the router, delete flows, command palette and theme toggle.

Two things need a real device before a pilot, because no test harness can reach them: `getUserMedia`
camera video and the native file/camera picker. Ten minutes of clicking through capture on an actual
phone is worth doing.
