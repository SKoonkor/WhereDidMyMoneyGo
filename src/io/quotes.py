"""Near-real-time quotes and option chains (Yahoo Finance).

Quotes are delayed ~15 min (yfinance) and rate-limited, so results are cached
in-memory for a few seconds to survive re-renders. Never raises for a single bad
lookup returning None; a hard failure raises ``stocks.StockError``.
"""

import time

import pandas as pd

from src.io.stocks import StockError

_PRICE_TTL = 15.0     # seconds
_CHAIN_TTL = 30.0
_INTRADAY_TTL = 60.0
_OHLCV_DAILY_TTL = 300.0
_price_cache: dict[str, tuple[float, float]] = {}   # ticker -> (price, ts)
_chain_cache: dict[str, tuple[dict, float]] = {}     # key -> (data, ts)
_intraday_cache: dict[str, tuple[object, float]] = {}  # key -> (Series, ts)
_ohlcv_cache: dict[str, tuple[object, float]] = {}   # key -> (DataFrame, ts)


def _yf(ticker: str):
    import yfinance as yf
    return yf.Ticker(ticker)


def live_price(ticker: str) -> float | None:
    """Latest trade price (cached ~15s); None if unavailable."""
    ticker = ticker.strip().upper()
    if not ticker:
        return None
    hit = _price_cache.get(ticker)
    if hit and time.time() - hit[1] < _PRICE_TTL:
        return hit[0]
    price = None
    try:
        fi = _yf(ticker).fast_info
        price = fi.get("lastPrice") if hasattr(fi, "get") else fi["lastPrice"]
        price = float(price) if price is not None else None
    except Exception:
        price = None
    if price is None:  # fallback: last daily close
        try:
            s = _yf(ticker).history(period="5d")["Close"].dropna()
            price = float(s.iloc[-1]) if len(s) else None
        except Exception:
            price = None
    if price is not None:
        _price_cache[ticker] = (price, time.time())
    return price


def live_prices(tickers) -> dict[str, float]:
    """Live prices for many tickers (missing ones omitted)."""
    out = {}
    for t in tickers:
        p = live_price(t)
        if p is not None:
            out[t.upper()] = p
    return out


def quote_details(ticker: str) -> dict:
    """Rich quote for the detail panel; raises StockError if the symbol is unknown."""
    ticker = ticker.strip().upper()
    try:
        fi = _yf(ticker).fast_info
        last = float(fi["lastPrice"])
    except Exception as exc:
        raise StockError(f"No quote for '{ticker}': {exc}") from exc
    if last is None:
        raise StockError(f"No quote for '{ticker}'.")

    def g(k):
        try:
            v = fi[k]
            return float(v) if v is not None else None
        except Exception:
            return None

    prev = g("previousClose")
    chg = (last - prev) if prev else None
    chg_pct = (chg / prev * 100) if (chg is not None and prev) else None
    return {"ticker": ticker, "last": last, "prev_close": prev,
            "day_high": g("dayHigh"), "day_low": g("dayLow"),
            "change": chg, "change_pct": chg_pct, "currency": _currency(fi)}


def _currency(fi) -> str:
    try:
        return fi["currency"] or "USD"
    except Exception:
        return "USD"


# ── Intraday bars ─────────────────────────────────────────────────────────────

def intraday(ticker: str, period: str = "1d", interval: str = "1m") -> pd.Series:
    """Intraday close series (~15-min delayed), cached ~60s.

    Yahoo serves 1m bars for the last ~7 days and 15m for ~60 days; the "1d"
    period returns the most recent *trading session*. The index is made tz-naive
    (tz-aware timestamps break figures sharing an axis with cached daily data).
    Empty Series on failure."""
    ticker = ticker.strip().upper()
    key = f"{ticker}|{period}|{interval}"
    hit = _intraday_cache.get(key)
    if hit is not None and time.time() - hit[1] < _INTRADAY_TTL:
        return hit[0]
    try:
        hist = _yf(ticker).history(period=period, interval=interval)
        s = hist["Close"].dropna()
        s.index = pd.to_datetime(s.index).tz_localize(None)
    except Exception:
        s = pd.Series(dtype=float)
    _intraday_cache[key] = (s, time.time())
    return s


_OHLCV_COLS = ["Open", "High", "Low", "Close", "Volume"]


def ohlcv(ticker: str, period: str | None = None, interval: str = "1d",
          start=None, end=None) -> pd.DataFrame:
    """Open/High/Low/Close/Volume bars for the price+volume chart, tz-naive index,
    TTL-cached (~60s intraday, ~300s daily) so the render tick doesn't re-download.
    Empty DataFrame on failure."""
    ticker = ticker.strip().upper()
    key = f"{ticker}|{period}|{interval}|{start}|{end}"
    ttl = _INTRADAY_TTL if interval != "1d" else _OHLCV_DAILY_TTL
    hit = _ohlcv_cache.get(key)
    if hit is not None and time.time() - hit[1] < ttl:
        return hit[0]
    try:
        kw = dict(interval=interval, auto_adjust=True)
        if period:
            kw["period"] = period
        if start is not None:
            kw["start"] = start
        if end is not None:
            kw["end"] = end
        hist = _yf(ticker).history(**kw)
        df = hist[_OHLCV_COLS].dropna(how="all")
        df.index = pd.to_datetime(df.index).tz_localize(None)
    except Exception:
        df = pd.DataFrame(columns=_OHLCV_COLS)
    _ohlcv_cache[key] = (df, time.time())
    return df


# ── Options ───────────────────────────────────────────────────────────────────

def option_expirations(ticker: str) -> list[str]:
    try:
        return list(_yf(ticker).options or [])
    except Exception:
        return []


def option_chain(ticker: str, expiry: str) -> dict:
    """Compact calls/puts rows for one expiry (cached ~30s)."""
    ticker = ticker.strip().upper()
    key = f"{ticker}|{expiry}"
    hit = _chain_cache.get(key)
    if hit and time.time() - hit[1] < _CHAIN_TTL:
        return hit[0]
    try:
        ch = _yf(ticker).option_chain(expiry)
    except Exception as exc:
        raise StockError(f"No option chain for '{ticker}' {expiry}: {exc}") from exc

    def rows(df) -> list[dict]:
        out = []
        for _, r in df.iterrows():
            out.append({
                "strike": float(r["strike"]),
                "last": _f(r.get("lastPrice")), "bid": _f(r.get("bid")),
                "ask": _f(r.get("ask")), "iv": _f(r.get("impliedVolatility")),
                "volume": _f(r.get("volume")), "oi": _f(r.get("openInterest")),
                "itm": bool(r.get("inTheMoney")),
                "symbol": str(r.get("contractSymbol", "")),
            })
        return out

    data = {"calls": rows(ch.calls), "puts": rows(ch.puts)}
    _chain_cache[key] = (data, time.time())
    return data


def _f(v):
    try:
        v = float(v)
        return None if pd.isna(v) else v
    except (TypeError, ValueError):
        return None


def _contract_price(row: dict) -> float | None:
    """Marketable price for a contract: mid(bid,ask), else last."""
    bid, ask, last = row.get("bid"), row.get("ask"), row.get("last")
    if bid and ask and bid > 0 and ask > 0:
        return (bid + ask) / 2
    return last if last else (bid or ask or None)


def option_price(ticker: str, expiry: str, right: str, strike: float) -> float | None:
    """Current per-share price of one contract (× 100 for total value)."""
    try:
        data = option_chain(ticker, expiry)
    except StockError:
        return None
    side = data["calls"] if right == "call" else data["puts"]
    for row in side:
        if abs(row["strike"] - float(strike)) < 1e-6:
            return _contract_price(row)
    return None
