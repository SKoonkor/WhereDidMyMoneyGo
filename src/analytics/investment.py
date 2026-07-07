"""Investment Simulator game model + persistence (config/investment_game.json).

A turn-based trading game on real historical prices. Each of up to 3 portfolios
starts with $10,000 and is stepped one trading day at a time. State is kept
minimal and **replayable**: only the trade list is stored per portfolio; cash,
holdings, and value series are derived by replaying trades against cached prices
(src/io/stocks.py), so mid-game edits stay consistent.
"""

import json
from pathlib import Path

import pandas as pd

from src.io import stocks as S
from src.io import fundamentals as FD

GAME_PATH = Path("config/investment_game.json")
START_CASH = 10_000.0
MAX_PORTFOLIOS = 3
_NAMES = ["Portfolio A", "Portfolio B", "Portfolio C"]


class GameError(Exception):
    """Invalid game action (bad ticker, insufficient cash/shares, etc.)."""


# ── Persistence ──────────────────────────────────────────────────────────────

def load_game(path: str | Path = GAME_PATH) -> dict | None:
    path = Path(path)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_game(game: dict, path: str | Path = GAME_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(game, f, indent=2, ensure_ascii=False)


def restart(path: str | Path = GAME_PATH) -> None:
    Path(path).unlink(missing_ok=True)


# ── Remembered stocks, carried across clear-all resets ────────────────────────
# Stored as {ticker: {"score": int, "sector": str}}. A stock scores +1 the first
# time it's bought in a game (capped at MAX_SCORE); on reset each sector keeps its
# top MAX_PER_SECTOR by score so the list doesn't grow forever.

STOCKS_PATH = Path("config/investment_stocks.json")
MAX_SCORE = 10
MAX_PER_SECTOR = 5


def load_remembered(path: str | Path = STOCKS_PATH) -> dict:
    """{ticker: {"score", "sector"}}; tolerates the legacy {ticker: count} format."""
    path = Path(path)
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (ValueError, OSError):
        return {}
    out = {}
    for ticker, val in raw.items():
        if isinstance(val, dict):
            out[ticker] = {"score": int(val.get("score", 0)),
                           "sector": val.get("sector", "Unknown")}
        else:  # legacy int buy-count
            out[ticker] = {"score": min(MAX_SCORE, int(val)), "sector": "Unknown"}
    return out


def save_remembered(data: dict, path: str | Path = STOCKS_PATH) -> None:
    """Persist at most MAX_PER_SECTOR tickers per sector, top score first."""
    by_sector: dict[str, list] = {}
    for ticker, v in data.items():
        by_sector.setdefault(v.get("sector", "Unknown"), []).append((ticker, v))
    kept = {}
    for rows in by_sector.values():
        rows.sort(key=lambda kv: (-kv[1]["score"], kv[0]))
        for ticker, v in rows[:MAX_PER_SECTOR]:
            kept[ticker] = v
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(kept, f, indent=2, ensure_ascii=False)


def remove_remembered(ticker: str, path: str | Path = STOCKS_PATH) -> None:
    data = load_remembered(path)
    if data.pop(ticker, None) is not None:
        save_remembered(data, path)


def remember_from_game(game: dict) -> None:
    """Fold every registered ticker into the remembered store before clearing:
    +1 score if it was bought this game (capped), keeping unbought ones too."""
    data = load_remembered()
    bought = buy_counts(game)
    for ticker in game["tickers"]:
        prev = data.get(ticker, {}).get("score", 0)
        score = min(MAX_SCORE, prev + (1 if ticker in bought else 0))
        sector = FD.get_fundamentals(ticker).get("sector", "Unknown")
        data[ticker] = {"score": score, "sector": sector}
    save_remembered(data)


def remembered_tickers() -> list[str]:
    """Remembered tickers, highest score first."""
    data = load_remembered()
    return [t for t, _ in sorted(data.items(),
                                 key=lambda kv: (-kv[1]["score"], kv[0]))]


def restart_keep(game: dict) -> dict:
    """Rewind the clock to day 1 but keep every portfolio and all its trades, so
    the same run replays (past trades re-apply on their original days)."""
    game["current_index"] = 0
    save_game(game)
    return game


# ── Setup ─────────────────────────────────────────────────────────────────────

def create_game(start, close) -> dict:
    """Start a new game; trading calendar = S&P 500 trading days in range."""
    start = pd.Timestamp(start).normalize()
    close = pd.Timestamp(close).normalize()
    if close <= start:
        raise GameError("Close date must be after the start date.")
    spx = S.fetch_close(S.SPX_TICKER, start, close)
    if spx.empty or len(spx) < 2:
        raise GameError("No market data in that date range.")
    game = {
        "start": start.date().isoformat(),
        "close": close.date().isoformat(),
        "trading_days": [d.date().isoformat() for d in spx.index],
        "current_index": 0,
        "tickers": [],
        "portfolios": [{"name": _NAMES[0], "trades": []}],
        "active": 0,
    }
    # Pre-register the user's most-bought stocks so they need not re-add them
    # (skip any without price data for this range).
    for ticker in remembered_tickers():
        try:
            if not S.fetch_close(ticker, start, close).empty:
                game["tickers"].append(ticker)
        except S.StockError:
            pass
    save_game(game)
    return game


# ── Price access ──────────────────────────────────────────────────────────────

_PRICE_CACHE: dict[str, pd.Series] = {}


def _prices(game: dict, ticker: str) -> pd.Series:
    """Cached close series (reindexed to the game calendar, forward-filled)."""
    key = f"{ticker}|{game['start']}|{game['close']}"
    if key not in _PRICE_CACHE:
        s = S.fetch_close(ticker, game["start"], game["close"])
        idx = pd.to_datetime(game["trading_days"])
        _PRICE_CACHE[key] = s.reindex(idx).ffill().bfill()
    return _PRICE_CACHE[key]


def price_on(game: dict, ticker: str, index: int) -> float:
    return float(_prices(game, ticker).iloc[index])


def days(game: dict) -> list[pd.Timestamp]:
    return list(pd.to_datetime(game["trading_days"]))


def current_date(game: dict) -> pd.Timestamp:
    return pd.to_datetime(game["trading_days"][game["current_index"]])


def is_over(game: dict) -> bool:
    return game["current_index"] >= len(game["trading_days"]) - 1


# ── Mutations ─────────────────────────────────────────────────────────────────

def advance(game: dict) -> dict:
    game["current_index"] = min(game["current_index"] + 1,
                                len(game["trading_days"]) - 1)
    save_game(game)
    return game


def add_portfolio(game: dict) -> dict:
    if len(game["portfolios"]) >= MAX_PORTFOLIOS:
        raise GameError(f"Maximum of {MAX_PORTFOLIOS} portfolios.")
    game["portfolios"].append({"name": _NAMES[len(game["portfolios"])], "trades": []})
    game["active"] = len(game["portfolios"]) - 1
    save_game(game)
    return game


def set_active(game: dict, idx: int) -> dict:
    if 0 <= idx < len(game["portfolios"]):
        game["active"] = idx
        save_game(game)
    return game


def rename_portfolio(game: dict, idx: int, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise GameError("Enter a portfolio name.")
    if 0 <= idx < len(game["portfolios"]):
        game["portfolios"][idx]["name"] = name[:24]
        save_game(game)
    return game


def add_ticker(game: dict, ticker: str) -> dict:
    ticker = (ticker or "").strip().upper()
    if not ticker:
        raise GameError("Enter a ticker symbol.")
    if ticker in game["tickers"]:
        return game
    try:
        prices = S.fetch_close(ticker, game["start"], game["close"])
    except S.StockError as exc:
        raise GameError(str(exc)) from exc
    if prices.empty:
        raise GameError(f"No price data for '{ticker}' in this range.")
    game["tickers"].append(ticker)
    _PRICE_CACHE.pop(f"{ticker}|{game['start']}|{game['close']}", None)
    save_game(game)
    return game


def is_held(game: dict, ticker: str) -> bool:
    """True if any portfolio currently holds shares of ``ticker``."""
    return any(ticker in replay(game, pf, game["current_index"])["holdings"]
               for pf in game["portfolios"])


def delete_ticker(game: dict, ticker: str, forever: bool = False) -> dict:
    """Remove a ticker from the game's list (blocked while it's held). When
    ``forever``, also drop it from the remembered store. Past net-zero trades are
    left intact so realized P/L is preserved."""
    if is_held(game, ticker):
        raise GameError(f"Sell your shares of {ticker} first.")
    if ticker in game["tickers"]:
        game["tickers"].remove(ticker)
    if forever:
        remove_remembered(ticker)
    save_game(game)
    return game


def record_trade(game: dict, pf_idx: int, ticker: str, amount, side: str,
                 mode: str = "shares") -> dict:
    """Buy/sell whole shares at the current day's close, validating funds/holdings.

    ``amount`` is a share count when ``mode == "shares"``, or a dollar amount when
    ``mode == "dollars"`` (converted to ``floor(amount / price)`` whole shares).
    """
    ticker = (ticker or "").strip().upper()
    if ticker not in game["tickers"]:
        raise GameError(f"Add '{ticker}' to the game first.")
    price = price_on(game, ticker, game["current_index"])
    if mode == "dollars":
        try:
            amt = float(amount)
        except (TypeError, ValueError):
            raise GameError("Enter a dollar amount.")
        if amt <= 0:
            raise GameError("Amount must be positive.")
        qty = amt / price  # fractional shares
    else:
        try:
            qty = float(amount)
        except (TypeError, ValueError):
            raise GameError("Enter a share quantity.")
        if qty <= 0:
            raise GameError("Quantity must be positive.")
    pf = game["portfolios"][pf_idx]
    state = replay(game, pf, game["current_index"])
    if side == "buy":
        if qty * price > state["cash"] + 1e-6:
            raise GameError(f"Not enough cash: need {qty * price:,.2f}, "
                            f"have {state['cash']:,.2f}.")
    elif side == "sell":
        if qty > state["holdings"].get(ticker, 0) + 1e-9:
            raise GameError(f"Not enough shares of {ticker} to sell.")
    else:
        raise GameError("Unknown trade side.")
    pf["trades"].append({"day": int(game["current_index"]), "ticker": ticker,
                         "qty": float(qty), "side": side})
    save_game(game)
    return game


# ── Derived state ─────────────────────────────────────────────────────────────

def replay(game: dict, pf: dict, upto_index: int) -> dict:
    """Cash + holdings after replaying ``pf``'s trades through ``upto_index``."""
    cash = START_CASH
    holdings: dict[str, float] = {}
    for tr in pf["trades"]:
        if tr["day"] > upto_index:
            continue
        price = price_on(game, tr["ticker"], tr["day"])
        if tr["side"] == "buy":
            cash -= tr["qty"] * price
            holdings[tr["ticker"]] = holdings.get(tr["ticker"], 0.0) + tr["qty"]
        else:
            cash += tr["qty"] * price
            holdings[tr["ticker"]] = holdings.get(tr["ticker"], 0.0) - tr["qty"]
    holdings = {t: q for t, q in holdings.items() if abs(q) > 1e-9}
    return {"cash": cash, "holdings": holdings}


def buy_counts(game: dict) -> dict:
    """Per-ticker number of buy trades across all portfolios."""
    counts: dict[str, int] = {}
    for pf in game["portfolios"]:
        for tr in pf["trades"]:
            if tr["side"] == "buy":
                counts[tr["ticker"]] = counts.get(tr["ticker"], 0) + 1
    return counts


def _sum(rows: list, key: str):
    """Sum a statement field over rows, or None if any value is missing."""
    vals = [r.get(key) for r in rows]
    return sum(vals) if vals and all(v is not None for v in vals) else None


def _ratios(fund: dict, game_date, price: float) -> dict:
    """P/E trio + Operating Margin / Revenue growth / P/S / D/E from statements as
    of ``game_date`` (nearest report on/before it; quarterly TTM preferred). Any
    metric that can't be computed is None."""
    d = pd.Timestamp(game_date).date().isoformat()
    q = [r for r in fund.get("quarterly", []) if r["date"] <= d]  # newest first
    a = [r for r in fund.get("annual", []) if r["date"] <= d]

    ttm_eps = _sum(q[:4], "eps") if len(q) >= 4 else None
    ttm_rev = _sum(q[:4], "revenue") if len(q) >= 4 else (a[0]["revenue"] if a else None)
    ttm_op = _sum(q[:4], "op_income") if len(q) >= 4 else (a[0]["op_income"] if a else None)

    def pe(eps):
        return price / eps if eps and eps > 0 else None

    trailing_pe = pe(ttm_eps)
    current_pe = pe(a[0]["eps"]) if a else None
    forward_pe = pe(q[0]["eps"] * 4) if q and q[0]["eps"] is not None else None

    op_margin = (ttm_op / ttm_rev * 100) if (ttm_op is not None and ttm_rev) else None

    rev_growth = None
    if len(a) >= 2 and a[0]["revenue"] and a[1]["revenue"]:
        rev_growth = (a[0]["revenue"] / a[1]["revenue"] - 1) * 100
    elif len(q) >= 5 and q[0]["revenue"] and q[4]["revenue"]:
        rev_growth = (q[0]["revenue"] / q[4]["revenue"] - 1) * 100

    shares = (q[0]["shares"] if q and q[0]["shares"] else
              (a[0]["shares"] if a and a[0].get("shares") else None))
    ps = (price * shares / ttm_rev) if (shares and ttm_rev) else None

    bs = q[0] if q else (a[0] if a else None)
    de = (bs["debt"] / bs["equity"]) if (bs and bs["debt"] is not None
                                         and bs.get("equity")) else None

    return {"trailing_pe": trailing_pe, "current_pe": current_pe,
            "forward_pe": forward_pe, "op_margin": op_margin,
            "rev_growth": rev_growth, "ps": ps, "de": de,
            "sector": fund.get("sector", "Unknown")}


def ticker_prices(game: dict) -> list[dict]:
    """Registered tickers with current price, day %, P/E trio and sector — grouped
    by sector (Unknown last), then most-bought first within a sector."""
    i = game["current_index"]
    counts = buy_counts(game)
    gdate = current_date(game)
    out = []
    for t in game["tickers"]:
        s = _prices(game, t)
        price = float(s.iloc[i])
        prev = float(s.iloc[i - 1]) if i > 0 else 0.0
        change = (price - prev) / prev * 100 if prev else 0.0
        fund = FD.get_fundamentals(t)
        r = _ratios(fund, gdate, price)
        out.append({"ticker": t, "name": fund.get("name") or t, "price": price,
                    "change": change, "sector": r["sector"],
                    "trailing_pe": r["trailing_pe"], "current_pe": r["current_pe"],
                    "forward_pe": r["forward_pe"]})
    out.sort(key=lambda r: (r["sector"] == "Unknown", r["sector"],
                            -counts.get(r["ticker"], 0), r["ticker"]))
    return out


def stock_metrics(game: dict, ticker: str) -> dict:
    """Full fundamental ratio set for one ticker at the current game date."""
    price = price_on(game, ticker, game["current_index"])
    return _ratios(FD.get_fundamentals(ticker), current_date(game), price)


def sector_tickers(game: dict, sector: str) -> list[str]:
    """Registered tickers belonging to ``sector`` (in game order)."""
    return [t for t in game["tickers"]
            if FD.get_fundamentals(t).get("sector", "Unknown") == sector]


def game_start_price(game: dict, ticker: str) -> float:
    """The ticker's close on the game's first day (base for normalization)."""
    return price_on(game, ticker, 0)


def company_name(ticker: str) -> str:
    """Full company name for a ticker (falls back to the symbol)."""
    return FD.get_fundamentals(ticker).get("name") or ticker


def ratio_history(game: dict, ticker: str, period: str, metric: str) -> pd.Series:
    """A fundamental ``metric`` as a time series over the ``period`` window: the
    ratio computed at each date from that day's price and the nearest statement
    on/before it. Missing values become NaN (chart gaps)."""
    hist = stock_history(game, ticker, period)
    if hist is None or hist.empty:
        return pd.Series(dtype=float)
    fund = FD.get_fundamentals(ticker)
    vals = [_ratios(fund, d, float(p)).get(metric) for d, p in hist.items()]
    return pd.Series([float("nan") if v is None else v for v in vals],
                     index=hist.index)


STOCK_RANGES = ["5D", "1M", "6M", "YTD", "1Y", "5Y", "ALL"]
_RANGE_DAYS = {"5D": 5, "1M": 31, "6M": 183, "1Y": 366, "5Y": 1827}


def stock_history(game: dict, ticker: str, period: str = "1Y") -> pd.Series:
    """Daily close history for ``ticker`` ending at the current game day, looking
    back by ``period`` (may extend before the game start). Empty on failure."""
    end = current_date(game)
    if period == "YTD":
        start = pd.Timestamp(end.year, 1, 1)
    elif period == "ALL":
        start = end - pd.DateOffset(years=40)
    else:
        start = end - pd.Timedelta(days=_RANGE_DAYS.get(period, 366))
    try:
        return S.fetch_close(ticker, start, end)
    except S.StockError:
        return pd.Series(dtype=float)


def holdings_rows(game: dict, pf_idx: int) -> dict:
    """Current-day holdings with per-row value, plus cash and total value."""
    pf = game["portfolios"][pf_idx]
    idx = game["current_index"]
    state = replay(game, pf, idx)
    rows = []
    invested = 0.0
    for ticker, qty in sorted(state["holdings"].items()):
        price = price_on(game, ticker, idx)
        value = qty * price
        invested += value
        rows.append({"ticker": ticker, "qty": qty, "price": price, "value": value})
    return {"rows": rows, "cash": state["cash"], "total": state["cash"] + invested}


def value_series(game: dict, pf: dict) -> pd.Series:
    """Portfolio value for each elapsed trading day (day 0 .. current)."""
    idx = game["current_index"]
    dates = days(game)[: idx + 1]
    vals = []
    for i in range(idx + 1):
        st = replay(game, pf, i)
        total = st["cash"] + sum(q * price_on(game, t, i)
                                 for t, q in st["holdings"].items())
        vals.append(total)
    return pd.Series(vals, index=dates)


def spx_series(game: dict) -> pd.Series:
    """S&P 500 normalised to START_CASH at the start, over elapsed days."""
    idx = game["current_index"]
    s = _prices(game, S.SPX_TICKER).iloc[: idx + 1]
    return START_CASH * s / float(s.iloc[0])


def profit_factor(series: pd.Series) -> float:
    """(G − L) / (G + L): G = Σ daily gains, L = Σ |daily losses| (0 if none)."""
    diffs = series.diff().dropna()
    g = float(diffs[diffs > 0].sum())
    loss = float(-diffs[diffs < 0].sum())
    return (g - loss) / (g + loss) if (g + loss) else 0.0


def summary(game: dict, pf: dict) -> dict:
    """Today's and total P/L ($ and %) plus the (G−L)/(G+L) metric."""
    s = value_series(game, pf)
    today_d = today_p = 0.0
    if len(s) >= 2:
        today_d = float(s.iloc[-1] - s.iloc[-2])
        today_p = today_d / float(s.iloc[-2]) * 100 if s.iloc[-2] else 0.0
    total_d = float(s.iloc[-1] - START_CASH)
    total_p = total_d / START_CASH * 100
    return {
        "value": float(s.iloc[-1]),
        "today_d": today_d, "today_p": today_p,
        "total_d": total_d, "total_p": total_p,
        "pf_metric": profit_factor(s),
    }
