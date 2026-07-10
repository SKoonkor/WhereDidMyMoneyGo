"""Historical stock price download with on-disk caching (Yahoo Finance).

One CSV per ticker under ``data/stocks_cache/`` (columns ``date,close`` of the
adjusted close). Downloads are fetched once and reused; a requested range outside
the cache triggers a re-fetch that is merged back in. Network/lookup failures
raise ``StockError`` so callers can show a friendly message instead of crashing.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CACHE_DIR = Path("data/stocks_cache")
SPX_TICKER = "^GSPC"          # S&P 500 index
SPX_LABEL = "S&P 500"


class StockError(Exception):
    """Raised when a ticker can't be found or prices can't be downloaded."""


def _cache_path(ticker: str) -> Path:
    safe = ticker.upper().replace("/", "_").replace("\\", "_")
    return CACHE_DIR / f"{safe}.csv"


def _read_cache(ticker: str) -> pd.Series | None:
    path = _cache_path(ticker)
    if not path.exists():
        return None
    df = pd.read_csv(path, parse_dates=["date"])
    if df.empty:
        return None
    return df.set_index("date")["close"].sort_index()


def _write_cache(ticker: str, s: pd.Series) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = s.rename("close").rename_axis("date").reset_index()
    out.to_csv(_cache_path(ticker), index=False)


def _coverage_path(ticker: str) -> Path:
    return _cache_path(ticker).with_suffix(".range.json")


def _read_coverage(ticker: str):
    """The contiguous [start, end] span we've actually downloaded, or None.

    Tracked separately from the data because a cache built from disjoint date
    ranges can have internal gaps — bracketing min/max is not enough to know a
    requested window is really covered."""
    import json
    path = _coverage_path(ticker)
    if not path.exists():
        return None
    try:
        d = json.loads(path.read_text())
        return pd.Timestamp(d["start"]), pd.Timestamp(d["end"])
    except (ValueError, KeyError):
        return None


def _write_coverage(ticker: str, start, end) -> None:
    import json
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _coverage_path(ticker).write_text(json.dumps(
        {"start": pd.Timestamp(start).date().isoformat(),
         "end": pd.Timestamp(end).date().isoformat()}))


def _download(ticker: str, start, end) -> pd.Series:
    import yfinance as yf
    try:
        hist = yf.Ticker(ticker).history(start=start, end=end, auto_adjust=True)
    except Exception as exc:  # network, parsing, etc.
        raise StockError(f"Could not download {ticker}: {exc}") from exc
    if hist is None or hist.empty or "Close" not in hist:
        raise StockError(f"No price data for '{ticker}'.")
    s = hist["Close"].copy()
    s.index = pd.to_datetime(s.index).tz_localize(None).normalize()
    return s[~s.index.duplicated(keep="last")].sort_index()


def fetch_close(ticker: str, start, end) -> pd.Series:
    """Adjusted daily close for ``ticker`` over [start, end], cached on disk.

    ``end`` is treated inclusively. Raises ``StockError`` on unknown ticker or a
    download failure when the cache can't satisfy the request.
    """
    ticker = ticker.strip().upper()
    start = pd.Timestamp(start).normalize()
    end = pd.Timestamp(end).normalize()

    cached = _read_cache(ticker)
    cov = _read_coverage(ticker)
    # Use the cache only when the request lies inside a span we've actually
    # downloaded contiguously (guards against gaps in a cache built from disjoint
    # ranges).
    if cached is not None and cov is not None and cov[0] <= start and cov[1] >= end:
        return cached.loc[start:end]

    # Expand to a contiguous superset so coverage stays gap-free, then download it.
    new_start = min(start, cov[0]) if cov else start
    new_end = max(end, cov[1]) if cov else end
    fresh = _download(ticker, new_start, new_end + pd.Timedelta(days=1))
    merged = fresh if cached is None else pd.concat([cached, fresh])
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    _write_cache(ticker, merged)
    _write_coverage(ticker, new_start, new_end)
    return merged.loc[start:end]


def validate_ticker(ticker: str) -> bool:
    """True if the symbol returns any recent data (cheap existence check)."""
    try:
        s = fetch_close(ticker, pd.Timestamp.today() - pd.Timedelta(days=10),
                        pd.Timestamp.today())
        return not s.empty
    except StockError:
        return False
