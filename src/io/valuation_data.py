"""Fundamental inputs for intrinsic-stock-valuation, with disk caching.

Pulls yfinance `.info` + the latest annual cash-flow and income statements into a
compact dict used by src/analytics/valuation.py, cached to
`data/stocks_cache/<T>.valuation.json` (~1-day TTL). The risk-free rate is the
current 10-year Treasury yield (`^TNX`). Never raises for missing fields (→ None);
a hard fetch failure raises ``stocks.StockError`` so the page can show a message.
"""

import json
import time
from pathlib import Path

import pandas as pd

from src.io.stocks import CACHE_DIR, StockError

_TTL_SECONDS = 24 * 3600


def _cache_path(ticker: str) -> Path:
    safe = ticker.upper().replace("/", "_").replace("\\", "_")
    return CACHE_DIR / f"{safe}.valuation.json"


def _num(v):
    try:
        v = float(v)
        return None if pd.isna(v) else v
    except (TypeError, ValueError):
        return None


def _row(df, name, col):
    if df is None or getattr(df, "empty", True) or name not in df.index:
        return None
    try:
        return _num(df.loc[name, col])
    except (KeyError, IndexError):
        return None


def _fetch(ticker: str) -> dict:
    import yfinance as yf
    t = yf.Ticker(ticker)
    try:
        info = t.get_info() or {}
    except Exception as exc:
        raise StockError(f"Could not load {ticker}: {exc}") from exc
    price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    if price is None:
        raise StockError(f"No price data for '{ticker}'.")

    try:
        cf = t.cashflow
    except Exception:
        cf = None
    try:
        inc = t.income_stmt
    except Exception:
        inc = None
    cf_col = cf.columns[0] if cf is not None and not cf.empty else None
    inc_col = inc.columns[0] if inc is not None and not inc.empty else None

    fcf = _row(cf, "Free Cash Flow", cf_col)
    cfo = _row(cf, "Operating Cash Flow", cf_col)
    capex = _row(cf, "Capital Expenditure", cf_col)  # negative in the statement
    if fcf is None and cfo is not None and capex is not None:
        fcf = cfo + capex  # capex is stored negative

    ebit = _row(inc, "EBIT", inc_col) or _row(inc, "Operating Income", inc_col)
    tax = _row(inc, "Tax Provision", inc_col)
    pretax = _row(inc, "Pretax Income", inc_col)
    tax_rate = (tax / pretax) if (tax is not None and pretax not in (None, 0)) else None

    return {
        "ticker": ticker.upper(),
        "name": info.get("longName") or info.get("shortName") or ticker.upper(),
        "sector": info.get("sector") or "Unknown",
        "currency": info.get("currency") or "USD",
        "price": price,
        "shares": _num(info.get("sharesOutstanding")),
        "beta": _num(info.get("beta")),
        "eps": _num(info.get("trailingEps")),
        "forward_eps": _num(info.get("forwardEps")),
        "book_value": _num(info.get("bookValue")),        # per share
        "dividend": _num(info.get("dividendRate")),        # per share, annual
        "payout": _num(info.get("payoutRatio")),
        "cash": _num(info.get("totalCash")),
        "debt": _num(info.get("totalDebt")),
        "roe": _num(info.get("returnOnEquity")),
        "rev_growth": _num(info.get("revenueGrowth")),
        "eps_growth": _num(info.get("earningsGrowth")),
        "fcf0": fcf,
        "ebit": ebit,
        "tax_rate": tax_rate,
        "div_paid": _row(cf, "Cash Dividends Paid", cf_col),
        "fetched": time.time(),
    }


def get_valuation_inputs(ticker: str) -> dict:
    """Cached fundamental inputs for ``ticker`` (refetched when stale)."""
    ticker = ticker.strip().upper()
    if not ticker:
        raise StockError("Enter a ticker symbol.")
    path = _cache_path(ticker)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if time.time() - data.get("fetched", 0) < _TTL_SECONDS and "price" in data:
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


def risk_free_rate() -> float:
    """Current 10-year Treasury yield (^TNX) as a decimal; fallback 0.04."""
    path = CACHE_DIR / "_TNX.rf.json"
    if path.exists():
        try:
            d = json.loads(path.read_text())
            if time.time() - d.get("fetched", 0) < _TTL_SECONDS:
                return float(d["rate"])
        except (ValueError, OSError, KeyError):
            pass
    rate = 0.04
    try:
        import yfinance as yf
        s = yf.Ticker("^TNX").history(period="5d")["Close"].dropna()
        if len(s):
            rate = float(s.iloc[-1]) / 100.0
    except Exception:
        pass
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"rate": rate, "fetched": time.time()}))
    except OSError:
        pass
    return rate
