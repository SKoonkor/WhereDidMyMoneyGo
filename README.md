# Money Tracker

A single-user, local, file-backed **personal-finance + investing suite** with a web UI.
It combines day-to-day money tracking (transactions, budgets, goals, reconciliation) with
market tooling (a historical investment simulator, an intrinsic-value calculator, and a live
paper-trading desk) — all running on your own machine with **no accounts, no API keys, and no
cloud**. Your data lives in plain `.xlsx`, `.json`, and `.toml` files under `data/` and `config/`.

- **Stack:** Python · [Dash](https://dash.plotly.com/) (multi-page) · Plotly · pandas · numpy · statsmodels
- **Market data:** [yfinance](https://github.com/ranaroussi/yfinance) (≈15-min-delayed quotes, keyless)
- **Storage:** local files only — no database
- **Runs at:** <http://127.0.0.1:8050>

> **Disclaimer.** This is a personal-finance tool for tracking and learning. Nothing here is
> financial advice. Paper trading is a **simulation** using delayed public quotes — no real
> orders are ever placed.

## Screenshots

<!-- Captured with synthetic sample data in an isolated sandbox — never a real ledger. -->

**Home dashboard** — 30-day money flow, income/expense pies, savings gauge, and budget summary.
![Home dashboard](docs/img/home.png)

**Paper Trading desk** — order ticket, live positions, an equity curve, and a watchlist on real delayed quotes.
![Paper trading desk](docs/img/paper.png)

**Money Flow** — running balance across accounts with a forward forecast and uncertainty bands.
![Money Flow](docs/img/flow.png)

**Budget** — a 50/30/20 model with spending-vs-budget for the current and previous month.
![Budget](docs/img/budget.png)

## Features

### Personal-finance core
- **Home dashboard** — 30-day snapshots of money flow, category pies, and a savings gauge; click a chart to open its page.
- **Money Flow** — running-balance waterfall; toggle accounts and pick date ranges.
- **Income / Expense** — category pies over 30 / 120 / 365 days or a custom period.
- **Financial Goals** — a savings-pool gauge; goals stack on top of your emergency fund.
- **Budget** — a Needs / Wants / Savings budget model with tracking against your spending.
- **Transactions** — a monthly ledger: add / edit / delete income, expenses (category › subcategory), and transfers. Automatic timestamped backups.
- **Reconcile Balances** — reconcile tracked account balances against the computed figures and surface hidden cost.
- **Compound Interest** — a standalone growth calculator with a ±20% rate band.

### Investing / markets
- **Investment Simulator** — a historical backtesting "game": buy/sell stocks at a chosen game date.
- **Stock Intrinsic Valuation** — DCF & multiples models (formulas documented in [`docs/intrinsic_value_formulas.md`](docs/intrinsic_value_formulas.md)).
- **Paper Trading** — the most developed module: live virtual trading on real delayed quotes, with multiple accounts (up to 3 portfolios each), market / limit / stop / trailing orders, short selling, options, a watchlist with fundamentals, sector comparison, and rich price+volume charts.

### Cross-cutting
- **Dark / light theme** toggle (remembered by your browser) — starts in dark mode; use the ◐ button, top-right of every page.
- **Privacy "censor" toggle** (👁) that masks exact money amounts across all figures — handy for screenshots or screen-sharing.
- **Disk caches** for market data with TTLs, under `data/stocks_cache/`.

## Requirements

- **Python 3.11 or newer** (developed and tested on 3.14).
- The packages in [`requirements.txt`](requirements.txt): pandas, openpyxl, numpy, plotly, dash, statsmodels, yfinance.

## Install & run

```bash
# from the project root
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run_app.py
```

Then open <http://127.0.0.1:8050>.

On **first run** the app bootstraps itself: it creates the `data/` directories and, if you don't
have a `config/` yet, seeds one from the shipped [`config.example/`](config.example/) templates.
It starts with **no transactions** — add your first one from the **Transactions** page, or point
it at your own `data/raw/transactions.xlsx`.

### Configuration via environment variables

| Variable | Default | Meaning |
|---|---|---|
| `MT_PORT` | `8050` | Port to serve on |
| `MT_HOST` | `127.0.0.1` | Interface to bind (localhost only by default) |
| `MT_DEBUG` | *(off)* | Set to `1`/`true` to enable Dash debug mode |

```bash
MT_PORT=9000 python run_app.py
```

> The bundled server is Flask's development server. It's fine for local single-user use; if you
> ever expose it, put it behind a proper WSGI server and keep `MT_DEBUG` off.

## Pages

| Page | Path | What it does |
|---|---|---|
| Home | `/` | 30-day snapshots; click a chart to open its page |
| Money Flow | `/flow` | Running-balance waterfall; account toggles + date ranges |
| Income / Expense | `/pie` | Category pies over 30 / 120 / 365 days or custom |
| Financial Goals | `/goals` | Savings-pool gauge; goals stack on the emergency fund |
| Compound Interest | `/compound` | Growth calculator with a ±20% band |
| Budget | `/budget` | Needs / Wants / Savings budget model & tracking |
| Transactions | `/transactions` (+ `/transactions/add`, `/transactions/edit/<id>`) | Monthly ledger: add / edit / delete income, expense, transfers |
| Reconcile Balances | `/reconcile` | Reconcile tracked vs. computed balances |
| Investment Simulator | `/invest` | Historical backtesting game |
| Stock Intrinsic Valuation | `/valuation` | DCF & multiples valuation |
| Paper Trading | `/paper` (accounts) → `/paper/trade` | Live virtual trading on delayed quotes |

## Your data & configuration

Everything personal lives under `config/` and `data/` — **both are git-ignored**, so your real
finances never get committed.

**`config/`** (seeded from `config.example/` on first run):

| File | Purpose |
|---|---|
| `settings.toml` | App name, base currency, data dir, emergency-fund target, date formats |
| `accounts.json` | Account names (also managed from the account picker) |
| `transaction_categories.json` | Income/expense category → subcategory tree |
| `goals.json` · `budget.json` · `forecast.json` · `reconciliation.json` | Created on demand by the relevant page |
| `investment_game.json` · `investment_stocks.json` · `paper_accounts/` | Created by the simulator / valuation / paper-trading features |

**`data/`**

```
data/
├── raw/           ← transactions.xlsx (the single source of truth)
├── backups/       ← automatic timestamped backups (20 most recent kept)
├── stocks_cache/  ← cached market data (regenerable)
└── processed/     ← reserved
```

### Recording transactions
The **Transactions** page edits `data/raw/transactions.xlsx` directly:
- **Add** — Income, Expense (category › subcategory), or Transfer between two accounts. **Save** returns to the list; **Continue** keeps the form open for batch entry.
- **Edit / Delete** — click any row; deleting a transfer removes both linked rows.
- **Safety** — a timestamped backup is written to `data/backups/` before every change.

## Project structure

```
money_tracker/
├── run_app.py          ← web app entry point (bootstraps data/ + config/ on first run)
├── config.example/     ← shipped config templates (copied to config/ on first run)
├── docs/               ← documentation (valuation formulas, images)
├── data/               ← your ledger, backups, caches (git-ignored)
├── config/             ← your settings (git-ignored)
├── requirements.txt
└── src/
    ├── io/             ← loader.py (read/clean) & writer.py (record/edit), quotes/fundamentals/stocks
    ├── processing/     ← balances & date filtering
    ├── analytics/      ← accounts, goals, budget, forecast, reconciliation, valuation, paper engine
    ├── utils/          ← config loading & first-run bootstrap
    └── app/            ← Dash app (pages/, figures/, assets/, data layer, theme)
```

## Market data

Quotes and fundamentals come from **yfinance**, which scrapes public Yahoo Finance data. It's
keyless and free but **unofficial** — it can rate-limit or break without notice. Quotes are
delayed (~15 min) and cached briefly on disk. Treat all market features as informational.

## License

Released under the [MIT License](LICENSE).
