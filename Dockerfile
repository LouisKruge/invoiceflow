# InvoiceFlow — single-container image. The backend serves the static frontend
# too, so this one image is the whole app; PostgreSQL runs separately (see
# docker-compose.yml for a local one, or point DATABASE_URL at a managed
# database such as Neon).

FROM node:20-bookworm-slim

WORKDIR /app

# Dependencies are installed from the lockfile alone, so this layer is only
# rebuilt when the dependencies actually change. Nothing here compiles native
# code — the app talks to PostgreSQL over the wire through `pg`.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund

COPY backend ./backend
COPY frontend ./frontend

# Uploaded invoice photos, imported spreadsheets and sign-out sheets are
# written here. Mount a volume at /app/backend/data so they survive a restart —
# the database holds the path to each file, not the file itself.
VOLUME ["/app/backend/data"]

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

WORKDIR /app/backend

CMD ["node", "server.js"]
