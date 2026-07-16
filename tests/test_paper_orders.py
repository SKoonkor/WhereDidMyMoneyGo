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
