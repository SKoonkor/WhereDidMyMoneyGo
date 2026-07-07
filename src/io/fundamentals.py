"""Company fundamentals (financial statements + sector) with disk caching.

Pulls yfinance financial statements once per ticker and stores a compact JSON
(`data/stocks_cache/<T>.fund.json`, ~7-day TTL). All P/E and other ratios are
computed elsewhere from these raw statement figures (not yfinance's `.info`
snapshot), so they can reflect a historical game date. `.info` is used only for
the static `sector` label. Never raises — failures yield empty statements so the
UI degrades to "n/a".
"""

import json
import time
from pathlib import Path

import pandas as pd

from src.io.stocks import CACHE_DIR

_TTL_SECONDS = 7 * 24 * 3600

# Statement row → output key.
_INCOME_ROWS = {"revenue": "Total Revenue", "op_income": "Operating Income",
                "net_income": "Net Income", "eps": "Diluted EPS"}
_BALANCE_ROWS = {"debt": "Total Debt", "equity": "Stockholders Equity",
                 "shares": "Ordinary Shares Number"}


def _cache_path(ticker: str) -> Path:
    safe = ticker.upper().replace("/", "_").replace("\\", "_")
    return CACHE_DIR / f"{safe}.fund.json"


def _cell(df, row, col):
    try:
        v = df.loc[row, col]
        v = float(v)
        return None if pd.isna(v) else v
    except (KeyError, TypeError, ValueError):
        return None


def _periods(income, balance) -> list[dict]:
    """Merge income + balance figures by period-end date, newest first."""
    if income is None or getattr(income, "empty", True):
        return []
    out = []
    for col in income.columns:
        try:
            date = pd.Timestamp(col).normalize().date().isoformat()
        except (ValueError, TypeError):
            continue
        row = {"date": date}
        for key, name in _INCOME_ROWS.items():
            row[key] = _cell(income, name, col)
        for key, name in _BALANCE_ROWS.items():
            row[key] = (_cell(balance, name, col)
                        if balance is not None and not balance.empty else None)
        out.append(row)
    out.sort(key=lambda r: r["date"], reverse=True)
    return out


# yfinance quoteType → a sector-style label for non-equities (which carry no
# GICS ``sector`` in .info), so ETFs/indices/crypto group instead of "Unknown".
_QUOTE_TYPE_SECTOR = {"ETF": "ETF", "MUTUALFUND": "ETF", "INDEX": "Index",
                      "CRYPTOCURRENCY": "Crypto"}


def _fetch(ticker: str) -> dict:
    import yfinance as yf
    t = yf.Ticker(ticker)
    quote_type = ""
    try:
        info = t.get_info() or {}
        quote_type = (info.get("quoteType") or "").upper()
        sector = (info.get("sector")
                  or _QUOTE_TYPE_SECTOR.get(quote_type) or "Unknown")
        name = info.get("longName") or info.get("shortName") or ticker
    except Exception:
        sector, name = "Unknown", ticker
    try:
        quarterly = _periods(t.quarterly_income_stmt, t.quarterly_balance_sheet)
    except Exception:
        quarterly = []
    try:
        annual = _periods(t.income_stmt, t.balance_sheet)
    except Exception:
        annual = []
    return {"sector": sector, "name": name, "quote_type": quote_type,
            "quarterly": quarterly, "annual": annual, "fetched": time.time()}


def get_fundamentals(ticker: str) -> dict:
    """Cached fundamentals for ``ticker``; refetched when the cache is stale."""
    ticker = ticker.strip().upper()
    path = _cache_path(ticker)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            # Valid only if fresh AND has the newer "name"/"quote_type" fields
            # (forces old caches to refetch so ETFs/crypto reclassify).
            if ("name" in data and "quote_type" in data
                    and time.time() - data.get("fetched", 0) < _TTL_SECONDS):
                return data
        except (ValueError, OSError):
            pass
    data = _fetch(ticker)
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False))
    except OSError:
        pass
    return data
