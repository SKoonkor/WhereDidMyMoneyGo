# Where Did My Money Go — web app

A **static, installable web app** (PWA) rebuild of the Money Tracker. It runs
entirely in the browser and stores all data **on the user's own device**
(IndexedDB) — no server, no accounts, no shared backend. The Python/Dash app in
the repo root remains the reference implementation and the desktop build.

This is **Phase 0** of the rewrite (see `../.claude/plans/`): app shell + PWA
install + on-device data, proven end-to-end with a Transactions demo. Feature
porting (dashboards, budgets, goals, retirement, tax, …) follows in later phases.

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
