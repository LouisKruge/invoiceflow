# InvoiceFlow — single-container image (backend serves the static frontend too).
FROM node:20-bullseye-slim AS base

# better-sqlite3 needs build tools to compile its native binding.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund

COPY backend ./backend
COPY frontend ./frontend

# Persistent data (SQLite DB + uploaded invoice images) lives here — mount a
# volume at /app/backend/data in production so it survives container restarts.
VOLUME ["/app/backend/data"]

ENV PORT=4000
EXPOSE 4000

WORKDIR /app/backend
CMD ["node", "server.js"]
