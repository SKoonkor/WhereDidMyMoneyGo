# config.example

Template configuration shipped with Money Tracker. On first run the app copies this
directory to `config/` if `config/` does not yet exist (see the first-run bootstrap in
`run_app.py`). Edit the copies under `config/` — never these templates — to customise the app.
`config/` is git-ignored, so your real settings never get committed.

## Files here

| File | Purpose |
|---|---|
| `settings.toml` | App name, base currency (stamped on new transactions + display currency), data dir, emergency-fund target, date formats |
| `accounts.json` | Starting list of account names |
| `transaction_categories.json` | Income/expense category → subcategory tree |

## Files the app creates on demand (not shipped)

These are **seeded automatically** the first time you use the relevant feature, so they are
intentionally absent from the templates:

- `goals.json` — seeded with an Emergency Fund goal
- `budget.json` — seeded with a sensible 50/30/20 default
- `forecast.json` — written when the money-flow forecast is first trained
- `reconciliation.json` — written when you first reconcile balances
- `investment_game.json`, `investment_stocks.json` — created by the simulator / valuation watchlist
- `paper_accounts/` — created when you open your first paper-trading account
