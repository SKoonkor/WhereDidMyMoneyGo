# Paper trading — string manifest

Every user-facing English string this feature ships, for W9 to land the Thai in one
commit. `src/i18n.ts` is W9's file; nothing here has touched it.

English **is** the key — `t('Buy')` returns `'Buy'` until a Thai entry exists — so
the feature works untranslated and W9's commit is purely additive.

Format: one string per line, grouped by the screen it appears on. `{placeholder}`
names are part of the key and must survive translation exactly. Strings that appear
on more than one screen are listed once, under **Shared**, and are not repeated.

Notes for the translator:

- `Δ Γ ν Θ` (PositionsList, OptionsPage) are the standard greek letters for the
  option greeks and are **not** translated — they are notation, like `%`.
- `SIM` is the permanent badge in the page header, beside the heading, on all three
  trading routes. Keep it to a few characters — it is a small pill next to a large
  heading and it must not wrap. Its `title` attribute (`Simulated market — no real
  money`) carries the full sentence, so the badge itself does not have to.
- `O` `H` `L` `C` are the OHLC legend's micro-labels, drawn on the canvas at 10px.
  One or two characters each, or the legend wraps over the candles.
- The lower-case fragments (`avg {price}`, `fee {amount}`, `spot`, `market`) are
  mid-sentence fragments in a metadata line, not sentences. They stay lower case.
- Thai has no word spaces: nothing here may be truncated by character count. The
  canvas layers measure and ellipsize; the DOM ones wrap.

---

## Shared (used on more than one screen)

Loading…
Cancel
Buy
Sell
Delete
Done
Equity
Leverage
Quantity
Contract size
Amount
Amount ({currency})
Paper trading
SIM
Simulated market — no real money
Back to the chart
Accounts
Options
Deposit
Withdraw

## Apps launcher tile (`features/apps/AppsPage.tsx`)

Simulators
Paper trading
Practise on a simulated market.

## Disclaimer gate (`DisclaimerGate.tsx`)

A market simulator. Read this once before you start.
None of this is real money.
The prices are generated on your device by a mathematical model. No exchange, no broker, and no connection to your accounts.
It cannot touch your tracked money.
The simulator keeps its own separate records. Your transactions, budgets and goals are never read or written by it.
Leverage and options are here to be learned, not recommended.
They can lose more than you put in — which is exactly why it is better to find that out here.
This is not financial advice.
Results in a simulator say nothing about results in a real market.
I understand — start the simulator

## Trading screen (`TradingPage.tsx`)

A market simulator. No real money, ever.
Margin level {pct}%. Positions are closed automatically below 100%.
24h {low} – {high}
Warming up…
Timeframe
Chart settings
Chart type
Indicators
Show order book depth
Colour-blind palette (blue / orange)
Account {name} · {cash} {currency} cash
{n} accounts · deposits, history and reset
Calls and puts on {symbol}

### Market data (the sim / live-crypto switch)

Market data
Simulated
Live crypto
Live streams real prices from a public crypto exchange, and needs a connection. Your money, orders and positions stay simulated either way.
No connection, so the simulated market stayed on.
Could not reach the exchange, so the simulated market stayed on.

### Chart-type names

Candles
Hollow
Heikin-Ashi
Bars
Line
Area

## Watchlist (`Watchlist.tsx`)

Symbols

## Chart overlay (`ChartPanel.tsx`)

Catching up · {time}
Reconnecting…
Feed stalled
Connecting…
Tap to clear
Entry
Liq.
Limit
Stop
O
H
L
C

## Order ticket (`OrderTicket.tsx`)

Market
Limit
Stop
Trailing
Margin
Switch to quantity
Switch to amount
Max
Buying power
Limit price
Stop price
Trail (%)
Reduce only
You get
{qty} at {price}
{value} {currency}
market
Enter an amount to see the estimate.
Buy {symbol}
Sell {symbol}
Filled.
Order placed.

## Leverage slider (`LeverageSlider.tsx`)

Liquidation
No liquidation at this size

## Confirm sheet (`ConfirmSheet.tsx`)

Confirm buy
Confirm sell
Price
Estimated price
At market
Order value
Fee
Margin required
Liquidation price
Margin level after
This opens a short: you will owe {qty} that you do not hold.
This sells more than you hold, leaving you short {qty}.

## Positions (`PositionsList.tsx`)

Positions
Nothing open. Your first order will show up here.
Long
Short
Close
avg {price}
mark {price}
liq {price}
funding {amount}
Δ {delta} · Γ {gamma} · ν {vega} · Θ {theta}

## Open orders (`OrdersList.tsx`)

Open orders
reduce only
trail {pct}%
#{seq}

## Order book (`DepthPanel.tsx`)

Order book
Spread
Waiting for the book…

## Speed control (`SpeedControl.tsx`)

Pause
Resume
Above {n}× the simulation works your device hard.
Live market data
Streaming
Live data runs at 1× and cannot be paused.

## Activity blotter (`Blotter.tsx`)

Activity
No activity yet.
Funding
Liquidated
Settled
fee {amount}
realised {amount}

## Accounts screen (`AccountsPage.tsx`)

Paper accounts
Simulated money only. Nothing here touches what you track.
Cash
Invested
Realised
Unrealised
Contributed
Margin level
Win rate
Closed trades
Your simulator starts with {amount}. Fund it to place your first trade.
All accounts
opened with {amount} {currency}
New paper account
Paper account
Name
Starting cash
Starting cash ({currency})
Create
Deposit paper money
Withdraw paper money
Reset the sandbox
Erases every paper account, position and price this simulator has generated, and starts a fresh market. Your transactions, budgets, goals and debts are untouched.
Reset the sandbox?
Every paper account, trade and simulated price is deleted and a new market begins. This cannot be undone. Your real transactions, budgets, goals and debts are not part of the sandbox and are not affected.
Erase and start over
Resetting…

## Equity curve (`EquityCurve.tsx`)

Equity over time
The curve starts with your first trade.
Largest drawdown

## Options screen (`OptionsPage.tsx`)

Simulated calls and puts on {symbol}. Cash-settled at expiry against a 30-minute average.
spot
Expiry
Calls
Puts
Call
Put
Strike
Bid
Ask
IV
Δ
Building the chain…
Contracts
Cost to buy
Credit to sell
Margin if sold
Implied volatility
Selling an option can lose far more than the credit you receive. At expiry it settles in cash against the last 30 minutes of the underlying.

## Trade errors (`errors.ts`)

One per `TradeErrorCode`. The map is an exhaustive `Record<TradeErrorCode, …>`, so
a code added to the union without a message here fails the build rather than
reaching a user as raw machine text.

Pick a symbol first.
{symbol} is not a symbol this sandbox trades.
No price yet — give the market a moment.
Enter a quantity greater than zero.
Enter an amount greater than zero.
Not enough cash: this needs {need} and you have {have}.
Not enough free collateral: this needs {need} and you have {have}.
Leverage is capped at {cap}× here.
Reduce-only, but this order would open a new position.
A limit order needs a limit price.
A stop order needs a stop price.
A trailing order needs a trail percentage.
That contract has already expired.
Your account owes {deficit}. Deposit first — you can close positions, but not open new ones.
The market is closed. This will fill when it opens.

## Cancel reasons (`errors.ts`)

One per `CancelReason`. Same exhaustiveness guarantee. The first three are not
refusals — they are an order reaching the end of the lifetime the user asked for —
so they should read as statements, not as complaints.

Cancelled
Expired — immediate-or-cancel
Expired — end of day
Cancelled — no symbol
Cancelled — unknown symbol
Cancelled — no price
Cancelled — bad quantity
Cancelled — bad amount
Cancelled — not enough cash at fill
Cancelled — not enough collateral at fill
Cancelled — over the leverage cap
Cancelled — reduce-only
Cancelled — no limit price
Cancelled — no stop price
Cancelled — no trail
Cancelled — contract expired
Cancelled — account in deficit
Cancelled — market closed

---

## Not translated, deliberately

- Indicator names (`SMA 20`, `SMA 50`, `EMA 9`, `EMA 21`) — universal notation on every
  charting platform, in every language.
- Timeframe chips (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) — same reason.
- Speed chips (`1×` … `1000×`) and leverage marks (`2×`, `5×` …) — numerals.
- Instrument symbols (`BTCUSDT`, `AAPL`, `BTCUSDT.P`) — they are identifiers.
- The `0.9.0` changelog entry in `src/data/changelog.ts` — the whole changelog is
  English-only by design.
