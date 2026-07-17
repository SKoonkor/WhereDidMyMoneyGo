"""Paper trading order engine: dust snapping, short warnings, fill residuals."""

import pytest

from src.analytics import paper as P

PRICE = 2.76


@pytest.fixture
def state(monkeypatch):
    """In-memory account with one portfolio; no disk writes, no live quotes."""
    monkeypatch.setattr(P, "mark_price", lambda meta: PRICE)
    monkeypatch.setattr(P, "save_state", lambda *a, **k: None)
    monkeypatch.setattr(P, "_snapshot", lambda *a, **k: None)
    pf = P._new_portfolio("Test", 100_000.0)
    return {"id": "test", "name": "Test", "active": 0, "portfolios": [pf]}


def _hold(state, symbol, qty, avg=PRICE):
    state["portfolios"][0]["positions"][symbol] = {
        "kind": "stock", "symbol": symbol, "mult": 1,
        "qty": qty, "avg_cost": avg, "mark": PRICE}


def _sell(state, symbol, qty):
    return P.place_order(state, {"kind": "stock", "symbol": symbol,
                                 "side": "sell", "otype": "market",
                                 "mode": "shares", "qty": qty})


def test_dust_snap_sell_closes_position(state):
    # $-mode buys leave e.g. 12280.282631694204 held; the user types the
    # display-rounded quantity — the sell must close the position exactly.
    _hold(state, "ENGS", 12280.282631694204)
    _sell(state, "ENGS", 12280.2826)
    assert "ENGS" not in state["portfolios"][0]["positions"]


def test_dust_snap_buy_covers_micro_short(state):
    _hold(state, "ENGS", -3.534005778906818e-05)
    P.place_order(state, {"kind": "stock", "symbol": "ENGS", "side": "buy",
                          "otype": "market", "mode": "shares", "qty": 0.0001})
    assert "ENGS" not in state["portfolios"][0]["positions"]


def test_no_snap_on_material_difference(state):
    # An intentional partial sell must stay a partial sell.
    _hold(state, "ENGS", 12280.28)
    _sell(state, "ENGS", 12000)
    remaining = state["portfolios"][0]["positions"]["ENGS"]["qty"]
    assert remaining == pytest.approx(280.28)


def test_no_snap_when_not_reducing(state):
    # Selling with no position (a fresh short) is never snapped.
    _sell(state, "NEWS", 5)
    assert state["portfolios"][0]["positions"]["NEWS"]["qty"] == -5


def test_preview_reports_short_details(state):
    _hold(state, "ENGS", 100.0)
    pend = P.preview_order(state, {"kind": "stock", "symbol": "ENGS",
                                   "side": "sell", "otype": "market",
                                   "mode": "shares", "qty": 150})
    assert pend["is_short"] is True
    assert pend["held"] == pytest.approx(100.0)
    assert pend["short_qty"] == pytest.approx(50.0)


def test_preview_full_close_is_not_short(state):
    _hold(state, "ENGS", 100.0)
    pend = P.preview_order(state, {"kind": "stock", "symbol": "ENGS",
                                   "side": "sell", "otype": "market",
                                   "mode": "shares", "qty": 100})
    assert pend["is_short"] is False and pend["short_qty"] == 0.0


def test_apply_fill_drops_sub_micro_residual(state):
    pf = state["portfolios"][0]
    meta = {"kind": "stock", "symbol": "DUST", "mult": 1}
    _hold(state, "DUST", 10.0000005)
    P._apply_fill(pf, meta, "sell", 10.0, PRICE, note="test")
    assert "DUST" not in pf["positions"]


# ── Market-hours realism ─────────────────────────────────────────────────────

def _et(y, m, d, hh, mm):
    from zoneinfo import ZoneInfo
    from datetime import datetime
    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("America/New_York"))


def test_market_open_now_sessions():
    assert P.market_open_now(now=_et(2026, 7, 16, 12, 0))        # Thu midday
    assert not P.market_open_now(now=_et(2026, 7, 18, 12, 0))    # Saturday
    assert not P.market_open_now(now=_et(2026, 7, 3, 12, 0))     # holiday
    assert not P.market_open_now(now=_et(2026, 7, 16, 8, 0))     # pre-market
    assert not P.market_open_now(now=_et(2026, 7, 16, 20, 0))    # after hours
    assert P.market_open_now(now=_et(2026, 7, 16, 9, 30))        # open bell
    assert not P.market_open_now(now=_et(2026, 7, 16, 16, 0))    # close bell
    # crypto trades around the clock regardless of the wall clock
    assert P.market_open_now(kind="crypto", now=_et(2026, 7, 18, 3, 0))
    assert P.market_open_now(symbol="BTC-USD", now=_et(2026, 7, 18, 3, 0))


def test_setting_off_fills_instantly_when_closed(state, monkeypatch):
    monkeypatch.setattr(P, "market_open_now", lambda *a, **k: False)
    # default behavior must be unchanged: instant fill even when closed
    msg = P.place_order(state, {"kind": "stock", "symbol": "AAPL",
                                "side": "buy", "otype": "market",
                                "mode": "shares", "qty": 1})
    assert msg.startswith("Filled:")
    assert state["portfolios"][0]["positions"]["AAPL"]["qty"] == 1


def test_setting_on_queues_market_order_when_closed(state, monkeypatch):
    monkeypatch.setattr(P, "market_open_now", lambda *a, **k: False)
    state["market_hours_only"] = True
    msg = P.place_order(state, {"kind": "stock", "symbol": "AAPL",
                                "side": "buy", "otype": "market",
                                "mode": "shares", "qty": 1})
    assert msg.startswith("Queued for market open")
    pf = state["portfolios"][0]
    assert "AAPL" not in pf["positions"]
    assert pf["orders"][-1]["status"] == "open"
    assert pf["orders"][-1]["otype"] == "market"
    # nothing fills while the market stays closed
    assert P.process(state) == 0
    assert pf["orders"][-1]["status"] == "open"
    # ...and it fills on the first tick after the open
    monkeypatch.setattr(P, "market_open_now", lambda *a, **k: True)
    monkeypatch.setattr(P, "_snapshot", lambda *a, **k: None)
    assert P.process(state) == 1
    assert pf["orders"][-1]["status"] == "filled"
    assert pf["positions"]["AAPL"]["qty"] == 1


def test_setting_on_crypto_fills_anytime(state):
    # the real market_open_now: crypto is exempt even on a weekend
    state["market_hours_only"] = True
    msg = P.place_order(state, {"kind": "stock", "symbol": "BTC-USD",
                                "side": "buy", "otype": "market",
                                "mode": "shares", "qty": 0.1})
    assert msg.startswith("Filled:")
