# Where Did My Money Go — web app

A **static, installable web app** (PWA) rebuild of the Money Tracker. It runs
entirely in the browser and stores all data **on the user's own device**
(IndexedDB) — no server, no accounts, no shared backend. The Python/Dash app in
the repo root remains the reference implementation and the desktop build.

**Phase 1 (core tracker) is complete** (see `../.claude/plans/`): the app shell +
PWA install + on-device data, plus a full money tracker —

- **Transactions** — add/edit/delete income, expense, and transfers (a transfer
  is two linked legs); monthly view with an income/expense/net summary.
- **Manage** — add/rename/reorder/remove accounts, categories, and subcategories;
  renames rewrite past transactions, deletes are blocked while an item is in use.
- **Import** — CSV/XLSX from other apps, with presets (Money Tracker export,
  Realbyte, YNAB, MeowJot) + a generic column-mapping UI; handles inflow/outflow,
  Thai headers, Buddhist-Era dates, and the `-` placeholder.
- **Export & backup** — spreadsheet export (CSV/XLSX) plus full JSON backup and
  restore, all client-side.
- **Settings** — app name, base currency, and month-start day.

Dashboards, budgets, goals, retirement, and tax follow in later phases.

## Stack

- **Vite + React + TypeScript** — static build, deploys to GitHub Pages / Netlify.
- **Dexie (IndexedDB)** — the "data stays on your device" store (`src/db.ts`).
- **vite-plugin-pwa** — manifest + service worker (offline shell, installable).
- **Plotly.js** — charts (ported from the Dash figures in later phases).
- **SheetJS** (`xlsx`) — in-browser CSV/XLSX import & export (Phase 1).
- **Vitest** — unit tests (parity tests ported from the Python `tests/` later).

## Develop

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run build      # type-check + production build to dist/
npm run preview    # serve the built app
```

## Deploy

- **GitHub Pages** — automatic via `.github/workflows/deploy-web.yml` on push to
  `main`. One-time: repo **Settings → Pages → Source = GitHub Actions**. Served at
  `https://<user>.github.io/WhereDidMyMoneyGo/` (the workflow sets
  `BASE_PATH=/WhereDidMyMoneyGo/`).
- **Netlify** — `netlify.toml` is preset (base `web`, publish `dist`). Serves at
  the site root, no base override needed.

## Install on a phone (the point of this app)

Open the deployed URL in the phone browser → **Share → Add to Home Screen**. It
launches full-screen (standalone) with its own icon, works offline after first
load, and keeps each person's data on their own phone.
