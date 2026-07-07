"""Paper Trading account model — a *live* virtual-money trading simulator.

Unlike the Investment Simulator (a turn-based replay of historical prices), this
is a continuous account traded at near-real-time quotes (yfinance, ~15-min
delayed) via :mod:`src.io.quotes`. State is a stateful ledger — cash, positions,
pending orders, an executed-trade blotter and an equity curve sampled over real
time — persisted to config/paper_trading.json.

Supported instruments: stocks / ETFs, crypto (e.g. ``BTC-USD``) and single-leg
options. Order types: market, limit, stop and trailing-stop; long and short.
Pending orders fill when a live-price tick crosses their trigger (:func:`process`).
"""

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

import pandas as pd

from src.io import quotes as Q
from src.io import stocks as S
from src.io import fundamentals as FD

# Multiple accounts (sessions), one JSON file each. A small pointer file records
# which account is selected; deleted accounts are moved to a backups folder.
ACCOUNTS_DIR = Path("config/paper_accounts")
BACKUPS_DIR = ACCOUNTS_DIR / "_backups"
POINTER_PATH = ACCOUNTS_DIR / "_selected.json"
LEGACY_PATH = Path("config/paper_trading.json")   # pre-multi-account single file
DEFAULT_CASH = 0.0             # accounts open empty; the user funds them via deposit
MAX_PORTFOLIOS = 3
MAX_CURVE = 4000            # cap equity-curve length
SNAPSHOT_MIN_GAP = 8.0      # seconds between equity snapshots on a tick
_NAMES = ["Portfolio A", "Portfolio B", "Portfolio C"]

# Instrument kinds that trade as ordinary tickers (multiplier 1).
_TICKER_KINDS = {"stock", "crypto"}
OPTION_MULT = 100


class TradeError(Exception):
    """Invalid trade/order action (bad symbol, insufficient funds, etc.)."""


# ── Time helpers ──────────────────────────────────────────────────────────────

def _now() -> str:
    # Naive local timestamps — kept tz-naive so the equity curve shares an axis
    # with the (tz-naive) cached S&P 500 series without comparison errors.
    return datetime.now().isoformat()


# ── Persistence (one JSON file per account) ───────────────────────────────────

def _account_path(acct_id: str) -> Path:
    return ACCOUNTS_DIR / f"{acct_id}.json"


def save_state(state: dict, path: str | Path | None = None) -> None:
    """Persist an account. The path defaults to the account's own id file, so
    callers holding only ``state`` write back to the right account with no extra
    wiring (an explicit path is used by tests)."""
    if path is None:
        path = _account_path(state["id"])
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def _read(path: Path) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return _migrate(json.load(f))
    except (ValueError, OSError):
        return None


def load_account(acct_id: str) -> dict | None:
    p = _account_path(acct_id)
    return _read(p) if p.exists() else None


def load_state(path: str | Path | None = None) -> dict | None:
    """The currently selected account (or the file at ``path`` for tests). Returns
    ``None`` when nothing is selected — the trading page then redirects to the
    account picker."""
    if path is not None:
        p = Path(path)
        return _read(p) if p.exists() else None
    sid = selected_id()
    return load_account(sid) if sid else None


def _migrate(state: dict) -> dict:
    """Backfill fields added over time so older files keep working: account id/name,
    the quote cache, and per-portfolio start_cash/contributed."""
    state.setdefault("id", uuid.uuid4().hex)
    state.setdefault("name", "Account")
    state.setdefault("quote_cache", {})
    default = state.get("start_cash", DEFAULT_CASH)
    for pf in state.get("portfolios", []):
        pf.setdefault("start_cash", default)
        pf.setdefault("contributed", pf["start_cash"])
    return state


def reset(path: str | Path = LEGACY_PATH) -> None:
    Path(path).unlink(missing_ok=True)


# ── Account selection pointer ─────────────────────────────────────────────────

def selected_id() -> str | None:
    if not POINTER_PATH.exists():
        return None
    try:
        sid = json.loads(POINTER_PATH.read_text()).get("id")
    except (ValueError, OSError):
        return None
    return sid if sid and _account_path(sid).exists() else None


def select_account(acct_id: str) -> None:
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
    POINTER_PATH.write_text(json.dumps({"id": acct_id}))


def clear_selection() -> None:
    POINTER_PATH.unlink(missing_ok=True)


def _new_portfolio(name: str, cash: float) -> dict:
    cash = float(cash)
    # ``start_cash`` is the immutable initial capital; ``contributed`` is the net
    # capital put in over time (initial + deposits − withdrawals) and is the basis
    # for total P/L, so moving cash in/out never reads as a trading gain/loss.
    return {"name": name, "cash": cash, "start_cash": cash, "contributed": cash,
            "positions": {}, "orders": [], "trades": [], "equity_curve": [],
            "realized": 0.0}


def create_account(name: str, start_cash: float = DEFAULT_CASH) -> str:
    """Create a new named account (opens empty unless a starting cash is given).
    Returns the new account id."""
    name = (name or "").strip()
    if not name:
        raise TradeError("Enter an account name.")
    if start_cash is None or start_cash == "":
        start_cash = DEFAULT_CASH
    try:
        start_cash = float(start_cash)
    except (TypeError, ValueError):
        raise TradeError("Enter a starting cash amount.")
    if start_cash < 0:
        raise TradeError("Starting cash can't be negative.")
    state = {
        "id": uuid.uuid4().hex,
        "name": name[:40],
        "created": _now(),
        "start_cash": start_cash,
        "active": 0,
        "watchlist": [],
        "order_seq": 0,
        "quote_cache": {},
        "portfolios": [_new_portfolio(_NAMES[0], start_cash)],
    }
    _snapshot(state)
    save_state(state)
    return state["id"]


# ── Account lifecycle: import / list / delete / restore ───────────────────────

def _import_legacy() -> None:
    """One-time: fold a pre-multi-account config/paper_trading.json into an account
    so nothing is lost, then rename it aside so it isn't imported twice."""
    if not LEGACY_PATH.exists():
        return
    if any(not p.name.startswith("_") for p in ACCOUNTS_DIR.glob("*.json")):
        return
    try:
        state = json.loads(LEGACY_PATH.read_text())
    except (ValueError, OSError):
        return
    state["id"] = uuid.uuid4().hex
    state.setdefault("name", "Imported account")
    _migrate(state)
    save_state(state)
    LEGACY_PATH.rename(LEGACY_PATH.with_name("paper_trading.imported.json"))


def _account_value(state: dict) -> tuple[float, float]:
    """(value, contributed) for an account from cached data only — no network. Value
    uses each portfolio's last equity snapshot (falling back to its cash)."""
    val = contributed = 0.0
    for pf in state.get("portfolios", []):
        curve = pf.get("equity_curve") or []
        val += curve[-1]["value"] if curve else pf.get("cash", 0.0)
        contributed += pf.get("contributed", pf.get("start_cash", 0.0))
    return val, contributed


def list_accounts() -> list[dict]:
    """Every account as a lightweight summary for the picker (no live quotes)."""
    _import_legacy()
    sid = selected_id()
    out = []
    for p in sorted(ACCOUNTS_DIR.glob("*.json")):
        if p.name.startswith("_"):
            continue
        try:
            state = _migrate(json.loads(p.read_text()))
        except (ValueError, OSError):
            continue
        val, contributed = _account_value(state)
        pl = val - contributed
        out.append({
            "id": state["id"], "name": state.get("name", "Account"),
            "created": state.get("created", ""), "value": val,
            "contributed": contributed, "pl": pl,
            "pl_pct": (pl / contributed * 100) if contributed > 0 else 0.0,
            "positions": sum(len(pf.get("positions", {}))
                             for pf in state.get("portfolios", [])),
            "selected": state["id"] == sid,
        })
    out.sort(key=lambda a: a["created"])
    return out


def delete_account(acct_id: str) -> None:
    """Soft-delete: move the account file into the backups folder (recoverable via
    :func:`restore_account`) and clear the selection if it pointed here."""
    p = _account_path(acct_id)
    if not p.exists():
        return
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.move(str(p), str(BACKUPS_DIR / f"{acct_id}__{ts}.json"))
    if selected_id() == acct_id:
        clear_selection()


def list_backups() -> list[dict]:
    """Deleted accounts available to restore, most-recent first."""
    if not BACKUPS_DIR.exists():
        return []
    out = []
    for p in sorted(BACKUPS_DIR.glob("*.json"), reverse=True):
        try:
            state = json.loads(p.read_text())
        except (ValueError, OSError):
            continue
        out.append({"file": p.name, "name": state.get("name", "Account"),
                    "created": state.get("created", ""),
                    "deleted": p.stem.split("__")[-1]})
    return out


def restore_account(backup_file: str) -> str:
    """Move a backup back into the active accounts folder (new id on collision)."""
    src = BACKUPS_DIR / Path(backup_file).name
    if not src.exists():
        raise TradeError("Backup not found.")
    state = _read(src)
    if state is None:
        raise TradeError("Backup is unreadable.")
    if _account_path(state["id"]).exists():
        state["id"] = uuid.uuid4().hex
    save_state(state)
    src.unlink(missing_ok=True)
    return state["id"]


# ── Portfolio management ──────────────────────────────────────────────────────

def _active(state: dict) -> dict:
    return state["portfolios"][state["active"]]


def add_portfolio(state: dict, start_cash=None) -> dict:
    if len(state["portfolios"]) >= MAX_PORTFOLIOS:
        raise TradeError(f"Maximum of {MAX_PORTFOLIOS} portfolios.")
    if start_cash is None or start_cash == "":
        cash = state["start_cash"]
    else:
        try:
            cash = float(start_cash)
        except (TypeError, ValueError):
            raise TradeError("Enter a starting cash amount.")
        if cash < 0:
            raise TradeError("Starting cash can't be negative.")
    pf = _new_portfolio(_NAMES[len(state["portfolios"])], cash)
    state["portfolios"].append(pf)
    state["active"] = len(state["portfolios"]) - 1
    save_state(state)
    return state


def _cash_amount(amount) -> float:
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        raise TradeError("Enter an amount.")
    if amt <= 0:
        raise TradeError("Amount must be positive.")
    return amt


def deposit(state: dict, pf_idx: int, amount) -> dict:
    """Add capital to a portfolio (e.g. depositing salary). Raises cash and the
    P/L basis together, so it is not counted as a gain."""
    amt = _cash_amount(amount)
    pf = state["portfolios"][pf_idx]
    pf["cash"] += amt
    pf["contributed"] = pf.get("contributed", pf.get("start_cash", 0.0)) + amt
    pf["trades"].append({"t": _now(), "kind": "cash", "side": "deposit",
                         "amount": amt})
    _snapshot(state, force=True)
    save_state(state)
    return state


def withdraw(state: dict, pf_idx: int, amount) -> dict:
    """Take capital out of a portfolio. Only free cash is withdrawable (positions
    are not liquidated). Lowers cash and the P/L basis together."""
    amt = _cash_amount(amount)
    pf = state["portfolios"][pf_idx]
    if amt > pf["cash"] + 1e-6:
        raise TradeError(f"Not enough free cash to withdraw: have "
                         f"{pf['cash']:,.2f}.")
    pf["cash"] -= amt
    base = pf.get("contributed", pf.get("start_cash", 0.0))
    pf["contributed"] = max(0.0, base - amt)
    pf["trades"].append({"t": _now(), "kind": "cash", "side": "withdraw",
                         "amount": amt})
    _snapshot(state, force=True)
    save_state(state)
    return state


def set_active(state: dict, idx: int) -> dict:
    if 0 <= idx < len(state["portfolios"]):
        state["active"] = idx
        save_state(state)
    return state


def rename_portfolio(state: dict, idx: int, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise TradeError("Enter a portfolio name.")
    if 0 <= idx < len(state["portfolios"]):
        state["portfolios"][idx]["name"] = name[:24]
        save_state(state)
    return state


def delete_portfolio(state: dict, idx: int) -> dict:
    """Remove a portfolio and everything it holds. Refuses the last one (an account
    must always have at least one portfolio) and keeps ``active`` valid."""
    pfs = state["portfolios"]
    if len(pfs) <= 1:
        raise TradeError("Can't delete the only portfolio.")
    if not 0 <= idx < len(pfs):
        raise TradeError("No such portfolio.")
    del pfs[idx]
    active = state.get("active", 0)
    if idx < active:                 # shift selection left to keep pointing at it
        active -= 1
    state["active"] = min(active, len(pfs) - 1)
    save_state(state)
    return state


# ── Watchlist ─────────────────────────────────────────────────────────────────

def add_watch(state: dict, ticker: str) -> dict:
    ticker = (ticker or "").strip().upper()
    if not ticker:
        raise TradeError("Enter a ticker symbol.")
    if ticker in state["watchlist"]:
        return state
    try:
        det = Q.quote_details(ticker)
    except S.StockError:
        raise TradeError(f"No live quote for '{ticker}'.")
    state["watchlist"].append(ticker)
    state.setdefault("quote_cache", {})[ticker] = {
        "mark": det["last"], "prev": det.get("prev_close"), "t": _now()}
    save_state(state)
    return state


def remove_watch(state: dict, ticker: str) -> dict:
    if ticker in state["watchlist"]:
        state["watchlist"].remove(ticker)
        save_state(state)
    return state


# ── Instrument helpers ────────────────────────────────────────────────────────

def option_symbol(underlying: str, expiry: str, right: str, strike: float) -> str:
    """A stable key for one option contract in the positions/orders dicts."""
    return f"{underlying.upper()}|{expiry}|{right}|{float(strike):g}"


def instrument_label(meta: dict) -> str:
    """Human label for a position/order, e.g. ``AAPL 2026-07-06 C302.5``."""
    if meta.get("kind") == "option":
        r = "C" if meta["right"] == "call" else "P"
        return f"{meta['underlying']} {meta['expiry']} {r}{meta['strike']:g}"
    return meta["symbol"]


def _mult(meta: dict) -> int:
    return OPTION_MULT if meta.get("kind") == "option" else 1


def mark_price(meta: dict) -> float | None:
    """Latest live mark for an instrument, or None if the feed is unavailable."""
    if meta.get("kind") == "option":
        return Q.option_price(meta["underlying"], meta["expiry"],
                              meta["right"], meta["strike"])
    return Q.live_price(meta["symbol"])


def _pos_mark(pos: dict) -> float:
    """Cached mark for a held position (last cached → avg cost). Refreshed once per
    tick by :func:`mark_all`, so valuation stays O(#positions) with no network."""
    return pos.get("mark") or pos.get("avg_cost") or 0.0


def mark_all(state: dict) -> None:
    """One consolidated quote refresh per tick: fetch every held + watchlist symbol
    once, storing last price + prev-close into the account's ``quote_cache`` and each
    position's ``mark``. Renders then read these cached values instead of re-hitting
    the quote feed on every update."""
    cache = state.setdefault("quote_cache", {})
    now = _now()
    tickers = set(state.get("watchlist", []))
    for pf in state["portfolios"]:
        for pos in pf["positions"].values():
            if pos.get("kind") != "option":
                tickers.add(pos["symbol"])
    for sym in tickers:                          # one quote_details per unique symbol
        try:
            det = Q.quote_details(sym)
        except S.StockError:
            continue
        cache[sym] = {"mark": det["last"], "prev": det.get("prev_close"), "t": now}
    for pf in state["portfolios"]:
        for pos in pf["positions"].values():
            if pos.get("kind") == "option":      # options priced individually
                m = mark_price(pos)
                if m is not None:
                    pos["mark"] = m
                    cache[pos["symbol"]] = {"mark": m, "prev": None, "t": now}
            else:
                c = cache.get(pos["symbol"])
                if c and c.get("mark") is not None:
                    pos["mark"] = c["mark"]


# ── Order execution ───────────────────────────────────────────────────────────

def _check_funds(pf: dict, meta: dict, side: str, qty: float, price: float) -> None:
    """Raise unless the fill is affordable (cash account, shorts need collateral)."""
    mult = _mult(meta)
    pos = pf["positions"].get(meta["symbol"])
    held = pos["qty"] if pos else 0.0            # signed (+long / -short)
    if side == "buy":
        cost = qty * price * mult
        if cost > pf["cash"] + 1e-6:
            raise TradeError(f"Not enough buying power: need {cost:,.2f}, "
                             f"have {pf['cash']:,.2f}.")
    else:  # sell — selling beyond a long opens/extends a short, which needs collateral
        short_open = max(0.0, qty - max(held, 0.0))
        need = short_open * price * mult
        if need > pf["cash"] + 1e-6:
            raise TradeError(f"Not enough collateral to short: need {need:,.2f}, "
                             f"have {pf['cash']:,.2f}.")


def _apply_fill(pf: dict, meta: dict, side: str, qty: float, price: float,
                note: str) -> float:
    """Mutate cash/positions for a fill; return realized P/L booked by it."""
    mult = _mult(meta)
    signed = qty if side == "buy" else -qty
    pf["cash"] -= signed * price * mult          # buy pays, sell receives

    sym = meta["symbol"]
    pos = pf["positions"].get(sym)
    old_qty = pos["qty"] if pos else 0.0
    old_avg = pos["avg_cost"] if pos else 0.0
    new_qty = old_qty + signed
    realized = 0.0

    if pos is None or old_qty == 0 or (old_qty > 0) == (signed > 0):
        # Opening or increasing on the same side → weighted-average cost.
        new_avg = ((abs(old_qty) * old_avg + abs(signed) * price) / abs(new_qty)
                   if abs(new_qty) > 1e-12 else price)
    else:
        # Reducing / closing / flipping → book realized on the closed quantity.
        closed = min(abs(signed), abs(old_qty))
        realized = closed * (price - old_avg) * (1 if old_qty > 0 else -1) * mult
        new_avg = old_avg if abs(signed) <= abs(old_qty) else price  # flip → new basis

    if abs(new_qty) < 1e-9:
        pf["positions"].pop(sym, None)
    else:
        kept = {k: meta[k] for k in
                ("kind", "symbol", "underlying", "expiry", "right", "strike", "mult")
                if k in meta}
        kept.update({"qty": new_qty, "avg_cost": new_avg, "mark": price})
        pf["positions"][sym] = kept

    pf["realized"] = pf.get("realized", 0.0) + realized
    pf["trades"].append({
        "t": _now(), "label": instrument_label(meta), "symbol": sym,
        "kind": meta.get("kind", "stock"), "side": side, "qty": qty,
        "price": price, "value": qty * price * mult, "realized": realized,
        "note": note,
    })
    return realized


def _resolve_meta(state: dict, spec: dict) -> dict:
    """Validate a trade spec and return a normalized instrument meta dict."""
    kind = spec.get("kind", "stock")
    if kind == "option":
        under = (spec.get("underlying") or "").strip().upper()
        expiry, right = spec.get("expiry"), spec.get("right")
        strike = spec.get("strike")
        if not (under and expiry and right in ("call", "put") and strike):
            raise TradeError("Pick an option contract (expiry, type and strike).")
        sym = option_symbol(under, expiry, right, strike)
        return {"kind": "option", "symbol": sym, "underlying": under,
                "expiry": expiry, "right": right, "strike": float(strike),
                "mult": OPTION_MULT}
    sym = (spec.get("symbol") or "").strip().upper()
    if not sym:
        raise TradeError("Enter a symbol to trade.")
    return {"kind": kind if kind in _TICKER_KINDS else "stock", "symbol": sym,
            "mult": 1}


def _qty_from_spec(spec: dict, price: float, mult: int) -> float:
    """Resolve share/contract count from either a raw qty or a $ amount."""
    if spec.get("mode") == "dollars":
        try:
            amt = float(spec.get("qty"))
        except (TypeError, ValueError):
            raise TradeError("Enter a dollar amount.")
        if amt <= 0:
            raise TradeError("Amount must be positive.")
        # Whole contracts for options; fractional shares for tickers.
        raw = amt / (price * mult)
        return float(int(raw)) if mult != 1 else raw
    try:
        qty = float(spec.get("qty"))
    except (TypeError, ValueError):
        raise TradeError("Enter a quantity.")
    if qty <= 0:
        raise TradeError("Quantity must be positive.")
    return float(int(qty)) if mult != 1 else qty


def _resolve_trade(state: dict, spec: dict):
    """Shared validation/resolution for a trade spec, used by both the confirmation
    preview and the executor. Returns ``(meta, side, otype, live, ref, qty)`` and
    raises ``TradeError`` on invalid input."""
    meta = _resolve_meta(state, spec)
    side = spec.get("side")
    if side not in ("buy", "sell"):
        raise TradeError("Choose Buy or Sell.")
    otype = spec.get("otype", "market")
    live = mark_price(meta)
    if live is None and otype == "market":
        raise TradeError(f"No live quote for {instrument_label(meta)}.")
    ref = live if live is not None else 0.0
    qty = _qty_from_spec(spec, ref or 1.0, _mult(meta))
    return meta, side, otype, live, ref, qty


def place_order(state: dict, spec: dict) -> str:
    """Execute a market order now, or queue a limit/stop/trailing order.

    ``spec`` keys: kind, symbol|(underlying,expiry,right,strike), side (buy/sell),
    otype (market/limit/stop/trailing), qty, mode (shares/dollars), and
    limit/stop/trail as the order type requires. Returns a status message.
    """
    pf = _active(state)
    meta, side, otype, live, ref, qty = _resolve_trade(state, spec)

    if otype == "market":
        _check_funds(pf, meta, side, qty, live)
        _apply_fill(pf, meta, side, qty, live, note="market")
        _snapshot(state, force=True)
        save_state(state)
        return f"Filled: {side} {qty:g} {instrument_label(meta)} @ {live:,.2f}"

    # Queue a pending order validated on each tick against the live price.
    def _num(key):
        try:
            return float(spec.get(key))
        except (TypeError, ValueError):
            return None

    order = {"kind": meta.get("kind"), "symbol": meta["symbol"], "side": side,
             "otype": otype, "qty": qty, "status": "open", "created": _now(),
             "limit": _num("limit"), "stop": _num("stop"), "trail": _num("trail"),
             "peak": ref or None}
    for k in ("underlying", "expiry", "right", "strike"):
        if k in meta:
            order[k] = meta[k]
    if otype == "limit" and order["limit"] is None:
        raise TradeError("Enter a limit price.")
    if otype == "stop" and order["stop"] is None:
        raise TradeError("Enter a stop price.")
    if otype == "trailing" and not order["trail"]:
        raise TradeError("Enter a trailing-stop percent.")

    state["order_seq"] = state.get("order_seq", 0) + 1
    order["id"] = f"{state['order_seq']}-{uuid.uuid4().hex[:6]}"
    pf["orders"].append(order)
    save_state(state)
    return f"Queued {otype} order: {side} {qty:g} {instrument_label(meta)}"


def preview_order(state: dict, spec: dict) -> dict:
    """Non-mutating dry-run of a trade for the confirmation popup. Returns display
    fields plus a normalized spec whose quantity is locked to shares, so confirming
    executes exactly the previewed quantity. Raises ``TradeError`` on invalid input
    (so the popup never opens for a bad entry)."""
    meta, side, otype, live, ref, qty = _resolve_trade(state, spec)
    mult = _mult(meta)
    held = _active(state)["positions"].get(meta["symbol"], {}).get("qty", 0.0)

    def _num(key):
        try:
            return float(spec.get(key))
        except (TypeError, ValueError):
            return None

    if otype == "limit":
        price = _num("limit")
        if price is None:
            raise TradeError("Enter a limit price.")
        approx = False
    elif otype == "stop":
        price = _num("stop")
        if price is None:
            raise TradeError("Enter a stop price.")
        approx = False
    elif otype == "trailing":
        if not _num("trail"):
            raise TradeError("Enter a trailing-stop percent.")
        price, approx = ref, True
    else:  # market
        price, approx = live, True

    norm = dict(spec)
    norm["mode"], norm["qty"] = "shares", qty
    return {
        "kind": "trade", "spec": norm, "action": side, "otype": otype,
        "label": instrument_label(meta), "qty": qty, "mult": mult,
        "symbol": meta.get("underlying") or meta["symbol"],
        "price": price, "approx": approx,
        "est": (qty * price * mult) if price else None,
        "is_option": meta.get("kind") == "option",
        "is_short": side == "sell" and qty > max(held, 0.0) + 1e-9,
    }


def preview_cash(state: dict, op: str, amount) -> dict:
    """Non-mutating dry-run of a deposit/withdraw for the confirmation popup."""
    amt = _cash_amount(amount)
    pf = _active(state)
    if op == "withdraw" and amt > pf["cash"] + 1e-6:
        raise TradeError(f"Not enough free cash to withdraw: have {pf['cash']:,.2f}.")
    return {"kind": "cash", "op": op, "amount": amt, "pf_name": pf["name"]}


def cancel_order(state: dict, order_id: str) -> dict:
    for pf in state["portfolios"]:
        for o in pf["orders"]:
            if o.get("id") == order_id and o["status"] == "open":
                o["status"] = "cancelled"
    save_state(state)
    return state


def _order_meta(o: dict) -> dict:
    return {k: o[k] for k in
            ("kind", "symbol", "underlying", "expiry", "right", "strike")
            if k in o}


def _triggered(o: dict, price: float) -> bool:
    """Whether a pending order's condition is met at ``price`` (updates trail peak)."""
    otype, side = o["otype"], o["side"]
    if otype == "limit":
        return price <= o["limit"] if side == "buy" else price >= o["limit"]
    if otype == "stop":
        return price >= o["stop"] if side == "buy" else price <= o["stop"]
    if otype == "trailing":
        trail = o["trail"] / 100.0
        if side == "sell":                       # ratchet the peak up, trigger on drop
            o["peak"] = max(o.get("peak") or price, price)
            return price <= o["peak"] * (1 - trail)
        o["peak"] = min(o.get("peak") or price, price)  # ratchet the trough down
        return price >= o["peak"] * (1 + trail)
    return False


def process(state: dict) -> int:
    """Fill any pending orders whose trigger the live price has crossed.

    Called on each refresh tick. Returns the number of orders filled so the UI
    can flag activity. Orders that can't be funded at fill time are cancelled.
    """
    filled = 0
    changed = False
    for pf in state["portfolios"]:
        for o in pf["orders"]:
            if o["status"] != "open":
                continue
            meta = _order_meta(o)
            price = mark_price(meta)
            if price is None:
                continue
            if not _triggered(o, price):
                changed = True  # trail peak may have moved
                continue
            meta["mult"] = _mult(meta)
            try:
                _check_funds(pf, meta, o["side"], o["qty"], price)
            except TradeError:
                o["status"] = "cancelled"
                o["note"] = "insufficient funds at fill"
                changed = True
                continue
            _apply_fill(pf, meta, o["side"], o["qty"], price, note=o["otype"])
            o["status"] = "filled"
            o["fill_price"] = price
            o["fill_t"] = _now()
            filled += 1
            changed = True
    if filled:
        _snapshot(state, force=True)
    if changed or filled:
        save_state(state)
    return filled


# ── Valuation / analytics ─────────────────────────────────────────────────────

def _position_value(pf: dict) -> float:
    total = 0.0
    for pos in pf["positions"].values():
        total += pos["qty"] * _pos_mark(pos) * _mult(pos)
    return total


def equity(pf: dict) -> float:
    return pf["cash"] + _position_value(pf)


def _snapshot(state: dict, force: bool = False) -> None:
    """Append (now, equity) to each portfolio's curve, throttled unless forced."""
    now = _now()
    for pf in state["portfolios"]:
        curve = pf["equity_curve"]
        if not force and curve:
            try:
                last = datetime.fromisoformat(curve[-1]["t"])
                if (datetime.fromisoformat(now) - last).total_seconds() < SNAPSHOT_MIN_GAP:
                    continue
            except ValueError:
                pass
        curve.append({"t": now, "value": round(equity(pf), 4)})
        if len(curve) > MAX_CURVE:
            del curve[: len(curve) - MAX_CURVE]


def refresh(state: dict) -> dict:
    """Re-mark positions, fill triggered orders and snapshot equity (one tick)."""
    mark_all(state)
    process(state)
    _snapshot(state)
    save_state(state)
    return state


def positions_rows(state: dict, pf_idx: int) -> list[dict]:
    pf = state["portfolios"][pf_idx]
    rows = []
    for pos in pf["positions"].values():
        mult = _mult(pos)
        price = _pos_mark(pos)
        value = pos["qty"] * price * mult
        cost = pos["qty"] * pos["avg_cost"] * mult
        unreal = value - cost
        rows.append({
            "symbol": pos["symbol"], "label": instrument_label(pos),
            "kind": pos.get("kind", "stock"), "qty": pos["qty"],
            "avg_cost": pos["avg_cost"], "price": price, "value": value,
            "unreal": unreal,
            "unreal_pct": (unreal / abs(cost) * 100) if abs(cost) > 1e-9 else 0.0,
            "sector": FD.get_fundamentals(pos["symbol"]).get("sector") or "Unknown",
        })
    rows.sort(key=lambda r: (-abs(r["value"]), r["label"]))
    return rows


def open_orders(pf: dict) -> list[dict]:
    return [o for o in pf["orders"] if o["status"] == "open"]


def _day_change(state: dict, pf: dict) -> float:
    """Sum of qty×(mark − prev_close) over ticker positions (options excluded),
    read from the cached quotes so no network is hit on a render."""
    cache = state.get("quote_cache", {})
    total = 0.0
    for pos in pf["positions"].values():
        if pos.get("kind") == "option":
            continue
        c = cache.get(pos["symbol"])
        if not c or not c.get("prev"):
            continue
        total += pos["qty"] * (_pos_mark(pos) - c["prev"])
    return total


def summary(state: dict, pf_idx: int) -> dict:
    pf = state["portfolios"][pf_idx]
    val = equity(pf)
    basis = pf.get("contributed", pf.get("start_cash", state["start_cash"]))
    invested = _position_value(pf)
    total_d = val - basis
    day_d = _day_change(state, pf)
    return {
        "value": val, "cash": pf["cash"], "invested": invested,
        "day_d": day_d, "day_p": (day_d / (val - day_d) * 100) if (val - day_d) else 0.0,
        "total_d": total_d, "total_p": total_d / basis * 100 if basis > 0 else 0.0,
        "realized": pf.get("realized", 0.0), "unrealized": total_d - pf.get("realized", 0.0),
    }


def equity_series(pf: dict) -> pd.Series:
    curve = pf["equity_curve"]
    if not curve:
        return pd.Series(dtype=float)
    idx = pd.to_datetime([p["t"] for p in curve])
    if idx.tz is not None:                       # guard against older tz-aware data
        idx = idx.tz_localize(None)
    return pd.Series([p["value"] for p in curve], index=idx)


def principal_series(pf: dict) -> pd.Series:
    """Net contributed capital over time, aligned to the equity curve's timestamps
    (a step line: start_cash then ±each deposit/withdrawal). This is the P/L basis,
    so the chart can show 'money put in' beneath each portfolio's equity line."""
    curve = pf.get("equity_curve") or []
    if not curve:
        return pd.Series(dtype=float)
    idx = pd.to_datetime([p["t"] for p in curve])
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    # Cumulative cash flows keyed by (tz-naive) timestamp.
    events = []                                  # (timestamp, signed_amount)
    for tr in pf.get("trades", []):
        if tr.get("kind") != "cash":
            continue
        ts = pd.to_datetime(tr["t"])
        if ts.tz is not None:
            ts = ts.tz_localize(None)
        sign = 1.0 if tr.get("side") == "deposit" else -1.0
        events.append((ts, sign * float(tr.get("amount", 0.0))))
    base = float(pf.get("start_cash", 0.0))
    vals = [base + sum(a for ts, a in events if ts <= t) for t in idx]
    return pd.Series(vals, index=idx)


def spx_benchmark(state: dict) -> pd.Series:
    """S&P 500 since account creation, normalized to the active portfolio's net
    contributed capital (its break-even), so the benchmark reads as "what if I'd put
    the same money in the index". Empty when the account is unfunded or on failure,
    so the chart simply omits the benchmark."""
    active = state["portfolios"][state["active"]]
    basis = active.get("contributed", active.get("start_cash", state["start_cash"]))
    if basis <= 0:
        return pd.Series(dtype=float)
    try:
        start = pd.Timestamp(state["created"])
        if start.tz is not None:                 # guard against older tz-aware data
            start = start.tz_localize(None)
        start = start.normalize()
        end = pd.Timestamp.today().normalize()
        s = S.fetch_close(S.SPX_TICKER, start, end + pd.Timedelta(days=1))
    except (S.StockError, ValueError, KeyError):
        return pd.Series(dtype=float)
    if s.empty:
        return pd.Series(dtype=float)
    return basis * s / float(s.iloc[0])


# ── Quotes for the watchlist / quote table ────────────────────────────────────

def watch_rows(state: dict) -> list[dict]:
    """Watchlist quotes from the cache, grouped like the Investing Simulator's list:
    sorted by (sector, ticker) with Unknown last, carrying sector + company name
    from the disk-cached fundamentals. A symbol not yet primed by a tick is fetched
    once so it isn't blank."""
    cache = state.get("quote_cache", {})
    rows = []
    for t in state["watchlist"]:
        c = cache.get(t)
        if not c:
            try:
                det = Q.quote_details(t)
                c = {"mark": det["last"], "prev": det.get("prev_close")}
            except S.StockError:
                continue
        last, prev = c.get("mark"), c.get("prev")
        if last is None:
            continue
        change = (last - prev) if prev else 0.0
        fund = FD.get_fundamentals(t)
        rows.append({"ticker": t, "last": last, "change": change,
                     "change_pct": (change / prev * 100) if prev else 0.0,
                     "sector": fund.get("sector") or "Unknown",
                     "name": fund.get("name") or t})
    rows.sort(key=lambda r: (r["sector"] == "Unknown", r["sector"], r["ticker"]))
    return rows


def watch_metrics(ticker: str, price: float) -> dict:
    """Fundamental multiples for a watchlist symbol at today's live price —
    the same ratio engine the Investing Simulator uses (op margin, revenue
    growth, P/S, P/E trio, D/E)."""
    from src.analytics.investment import _ratios  # pure fn: (fund, date, price)
    return _ratios(FD.get_fundamentals(ticker), pd.Timestamp.today(), price)


def sector_watch_tickers(state: dict, sector: str) -> list[str]:
    """Watchlist tickers belonging to ``sector`` (watchlist order)."""
    return [t for t in state["watchlist"]
            if (FD.get_fundamentals(t).get("sector") or "Unknown") == sector]


def company_name(ticker: str) -> str:
    return FD.get_fundamentals(ticker).get("name") or ticker


def trade_history(state: dict, pf_idx: int, limit: int | None = 60) -> list[dict]:
    """The active portfolio's transaction log (trades + cash flows), newest first.
    ``limit=None`` returns the full history (for the popup viewer)."""
    pf = state["portfolios"][pf_idx]
    out = []
    for tr in pf.get("trades", []):
        if tr.get("kind") == "cash":             # deposit / withdraw
            out.append({"t": tr["t"], "side": tr["side"], "label": "Cash",
                        "qty": None, "price": None,
                        "value": tr.get("amount", 0.0), "realized": None})
        else:                                    # buy / sell fill
            out.append({"t": tr["t"], "side": tr["side"],
                        "label": tr.get("label", tr.get("symbol", "")),
                        "qty": tr.get("qty"), "price": tr.get("price"),
                        "value": tr.get("value", 0.0),
                        "realized": tr.get("realized", 0.0)})
    out.reverse()
    return out if limit is None else out[:limit]
