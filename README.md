# InvoiceFlow

Physical paper invoice → phone camera → AI extraction → validated data → approval → Excel export.

A working MVP: Express + SQLite backend, vanilla-JS mobile-first frontend (no build step), AI extraction
that runs on a realistic **mock provider out of the box** and swaps to live Claude vision extraction the
moment you add an API key.

---

## 1. Fastest path to a running pilot (today)

### Option A — plain Node (simplest, no Docker needed)

Requires Node.js 20+.

```bash
cd backend
cp .env.example .env
npm install
npm start
```

Open **http://localhost:4000**. On first boot the server automatically seeds three demo accounts and a
handful of sample invoices — you don't need to run anything else.

| Role       | Email                         | Password       |
|------------|--------------------------------|----------------|
| Admin      | admin@invoiceflow.demo         | admin123       |
| Processor  | processor@invoiceflow.demo     | processor123   |
| Reviewer   | reviewer@invoiceflow.demo      | reviewer123    |

To put this in front of real users on a phone (not just your laptop), the simplest option is a tunnel:

```bash
npx localtunnel --port 4000
# or: ngrok http 4000
```

**Camera capture needs HTTPS** (or `localhost`) — browsers block `getUserMedia` on plain `http://` from a
non-localhost address. A tunnel gives you HTTPS for free. If you deploy behind your own domain, make sure
it's served over TLS (see options B/C below, which both give you HTTPS automatically).

### Option B — Docker (one command, portable to any VM)

```bash
docker compose up -d --build
```

Runs on port 4000, with invoice data and uploaded images persisted in a named volume
(`invoiceflow-data`) so they survive container restarts. Set real values in a `.env` file next to
`docker-compose.yml` (see `backend/.env.example` for the variables it reads) before running in front of
anyone but yourself — at minimum change `JWT_SECRET`.

> Note: the Docker build wasn't run in the sandbox this was built in (no Docker daemon available there),
> but the Dockerfile is a standard Node 20 + `better-sqlite3` build — same pattern used everywhere that
> package ships. Worth a first local `docker compose up --build` before you rely on it for the pilot.

### Option C — Render / Railway / Fly.io (a real public URL, HTTPS included)

All three can deploy directly from this folder:

1. Push this project to a GitHub repo.
2. Create a new **Web Service** (Render) or project (Railway/Fly) pointing at the repo.
3. Build command: `cd backend && npm install`. Start command: `node backend/server.js` (a `Procfile` is
   included for platforms that read one).
4. Set environment variables from `backend/.env.example` in the platform's dashboard — at minimum
   `JWT_SECRET`, and `ANTHROPIC_API_KEY` if you want live AI extraction rather than the mock.
5. **Important:** SQLite writes to a local file (`backend/data/db/`) and uploaded images go to
   `backend/data/uploads/`. Most of these platforms use ephemeral disks by default — attach a persistent
   volume/disk to `backend/data` (Render has a "Disks" option; Railway has volumes) or your data will
   disappear on redeploy. For a short pilot this may not matter; for anything longer, attach storage.

---

## 2. Turning on live AI extraction

Out of the box, `AI_PROVIDER=mock` in `.env` — every capture returns a realistic, varied sample
extraction (with occasional low-confidence fields and one intentional VAT/total mismatch baked in about
30% of the time) so you can demo the full workflow with zero external dependencies.

To extract real invoices with Claude:

```bash
# in backend/.env
ANTHROPIC_API_KEY=sk-ant-...
AI_PROVIDER=claude
```

If the Claude call fails for any reason (bad key, rate limit, network), the app automatically falls back
to the mock extractor for that invoice and logs the error into the invoice's processing history — it
never leaves the employee with a blank screen or a silent failure.

Extraction lives entirely in `backend/services/aiExtraction.js` — the rest of the app only ever calls
`extractInvoice(filePath, mimeType)` and reads back a normalized `{ fields, lineItems, confidence }`
shape, so swapping in a different vision provider later means writing one new function, not touching
routes, validation, or the database.

---

## 3. What's implemented vs. what's scaffolded for later

**Fully working today:**
- Capture via live camera (with a scan-frame guide and a basic brightness warning) or file/PDF upload
- AI extraction (mock + real Claude vision path), per-field confidence scores
- Validation engine: subtotal+VAT=total check, duplicate detection (supplier+invoice number+total),
  missing-field checks, VAT-rate sanity check
- Review screen with inline editing (re-validates on save), approve/reject
- Full audit trail per invoice (uploaded → extracted → validated → edited → approved, with actor + time)
- Search/filter across invoice number, supplier, VAT number, PO number, amount; status filter chips
- Excel export (all / selected / date range) with a Line Items sheet, via ExcelJS
- Dashboard, Suppliers (auto-created from captured invoices), Reports (spend by supplier)
- JWT auth, 3 roles (admin/processor/reviewer), role-gated approve/reject
- Error handling: a failed extraction becomes a visible "exception" record with a retry/retake path,
  never a silent failure

**Scaffolded but intentionally not built out** (per the original spec — architecture is ready, features
are not, so none of this requires a schema change later):
- `purchase_orders` / `goods_received_notes` tables exist; PO *matching logic* is not implemented
- Accounting/ERP integrations (Sage, Xero, QuickBooks, SAP, etc.), email/WhatsApp invoice intake
- True computer-vision document edge detection / auto-crop / blur detection — the capture screen has a
  visual guide frame and a simple brightness heuristic, not real CV
- SQLite is used in place of PostgreSQL for zero-setup local/pilot use. The schema
  (`backend/db.js`) is written in plain portable SQL specifically so this is a low-effort swap: replace
  `better-sqlite3` with `pg`, change `AUTOINCREMENT`-style bits to `SERIAL`/`IDENTITY`, and nothing in
  `routes/` or `services/` needs to change, since they only ever go through the query functions in `db.js`.

---

## 4. Project layout

```
invoiceflow/
├── backend/
│   ├── server.js            entry point — also serves the frontend statically
│   ├── db.js                SQLite schema (Postgres-portable) + connection
│   ├── seed.js               demo users + sample invoices (auto-runs on first boot)
│   ├── middleware/auth.js    JWT auth + role guard
│   ├── services/
│   │   ├── aiExtraction.js   Claude vision call + mock fallback (swap point for other providers)
│   │   ├── validation.js     math/duplicate/missing-field/VAT checks
│   │   └── exportExcel.js    ExcelJS workbook builder
│   └── routes/
│       ├── auth.js, invoices.js, dashboard.js, suppliers.js, export.js
├── frontend/
│   ├── index.html
│   ├── css/styles.css        design tokens + full stylesheet
│   └── js/
│       ├── api.js            fetch client
│       ├── camera.js         live camera capture + native picker fallback
│       ├── views.js          render functions (pure HTML string templates)
│       └── app.js            router, state, event wiring
├── Dockerfile / docker-compose.yml / Procfile
```

---

## 5. Testing notes

The full workflow (login → capture → AI extraction → validation → review → edit → approve → Excel
export) was exercised end-to-end during development: via direct API calls (curl) for every backend route,
and via a scripted DOM test (jsdom, since this sandbox's outbound network wouldn't allow downloading a
headless Chrome binary for Puppeteer) that drove the actual frontend JavaScript through login, every page
route, an inline field edit, and a full approve action, with the browser's error console monitored
throughout — it came back clean. That covers everything except the two truly native browser leaves —
`getUserMedia` camera video and native file/camera picker dialogs — which need a real device to try before
relying on them for the pilot. Worth 10 minutes of manual clicking through the whole flow on an actual
phone before you hand this to employees.
