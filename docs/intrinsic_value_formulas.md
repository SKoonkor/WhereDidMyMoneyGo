# Intrinsic Value Formula Sheet
### A reference for building an investing simulator

All formulas are written in code-style ASCII so they translate directly into game logic.

> **Fact-checked 2026-07-04** against standard references (CAPM/WACC, Gordon &
> H-model DDM, residual income, justified P/E, Graham 1974, EPV) and against
> known-answer worked examples — the formulas in this sheet are correct.
> `src/analytics/valuation.py` now implements them faithfully (H-model DDM,
> clean-surplus RI with ROE fade, sustainable-growth justified P/E, WACC/r_e
> pairing per §1.2, Graham growth cap).

---

## 0. Notation

```
V0        intrinsic value today            r      discount rate (decimal, e.g. 0.09)
CF_t      cash flow in year t              r_e    cost of equity
N         explicit forecast years          r_d    pre-tax cost of debt
TV_N      terminal value at year N         tau    tax rate
g, g1, g2 growth rates by stage            r_f    risk-free rate (10y govt bond)
g_T       terminal (perpetual) growth      ERP    equity risk premium
EV        enterprise value                 beta   stock beta vs market
P         current market price/share       B_t    book value of equity, year t
S         shares outstanding               D_t    dividend per share, year t
NOPAT     EBIT * (1 - tau)                 ROIC   return on invested capital
RONIC     return on NEW invested capital   NWC    net working capital
```

Discount factor: `DF(t) = 1 / (1 + r)^t`

---

## 1. Building blocks (shared by every model)

### 1.1 Cash flow definitions
```
FCFF = EBIT*(1 - tau) + D&A - CapEx - dNWC          # to ALL capital providers
FCFF = CFO + Interest*(1 - tau) - CapEx             # equivalent, from cash flow stmt
FCFE = NetIncome + D&A - CapEx - dNWC + NetBorrowing # to shareholders only
FCFE = FCFF - Interest*(1 - tau) + NetBorrowing
FCF_simple = CFO - CapEx                            # what most retail tools use
```
Note: `FCF_simple` is **post-interest** (CFO already deducts interest paid), so it
is equity-tinted — strictly it sits between FCFF and FCFE. Discounting it at WACC
and then bridging `− debt` (the retail-calculator convention used in Model A)
slightly double-counts debt. Acceptable simplification; know that it exists.

### 1.2 Discount rates — MUST match the cash flow
```
r_e  = r_f + beta * ERP                    # CAPM; add country/size premium if needed
WACC = (E/V)*r_e + (D/V)*r_d*(1 - tau)    # V = E + D at market values

PAIRING RULE (never violate):
  FCFF  -> discount at WACC  -> gives Enterprise Value
  FCFE  -> discount at r_e   -> gives Equity Value directly
  Dividends -> discount at r_e
```

### 1.3 Terminal value variants
```
Gordon growth:   TV_N = CF_N * (1 + g_T) / (r - g_T)      REQUIRES r > g_T
No growth:       TV_N = CF_N / r
Exit multiple:   TV_N = Multiple * Metric_N               e.g. 12 * EBITDA_N (gives EV)
Value driver:    TV_N = NOPAT_(N+1) * (1 - g_T/RONIC) / (WACC - g_T)
                 # if RONIC = WACC this collapses to NOPAT/WACC: growth adds NO value
```

### 1.4 Enterprise-to-equity bridge and per-share value
```
EquityValue = EV + Cash - TotalDebt - MinorityInterest - PreferredStock
FairValue_per_share = EquityValue / S
```

### 1.5 Margin of safety (two common conventions)
```
MoS_upside   = FairValue / P - 1        # dcfcalc.com style: +19% means undervalued
MoS_discount = 1 - P / FairValue        # Graham style: buy at 25-50% discount
```

### 1.6 Mid-year convention (optional realism: cash arrives through the year)
```
DF_midyear(t) = 1 / (1 + r)^(t - 0.5)   # raises value by roughly (1+r)^0.5
```

---

## 2. Model catalog

### MODEL A — Two-stage FCF DCF (dcfcalc.com / standard retail value investing)
Inputs: `FCF0, g1, g2, g_T, r, N=10, Cash, Debt, S`
```
FCF_t = FCF0 * (1 + g1)^t                       for t = 1..5
FCF_t = FCF_5 * (1 + g2)^(t - 5)                for t = 6..10
TV_10 = FCF_10 * (1 + g_T) / (r - g_T)

EV    = SUM_{t=1..10} [ FCF_t / (1+r)^t ]  +  TV_10 / (1+r)^10
FairValue = (EV + Cash - Debt) / S
```
Typical inputs: r = 8-10% (12-15% for risky names), g_T = 2-3%,
g2 often set to about half of g1 as the company matures.
Best for: predictable cash-generating companies. Not for banks, startups, cyclicals.

### MODEL B — Three-stage value-driver DCF (Morningstar / McKinsey style)
Growth only creates value when return on new capital beats the cost of capital.
Inputs: `NOPAT path, ROIC/RONIC path, g path, WACC, moat horizon`
```
Stage 1 (years 1..N1, explicit forecast, N1 = 5-10):
    FCFF_t = NOPAT_t - NetNewInvestment_t          # full line-item forecast

Stage 2 (years N1+1..N2, fade period, length 0-15 yrs set by moat):
    IR_t     = g_t / RONIC_t                       # investment rate needed to fund g
    FCFF_t   = NOPAT_t * (1 - IR_t)
    RONIC_t  fades LINEARLY from RONIC_N1 down to WACC
    g_t      fades toward g_T

Stage 3 (perpetuity, zero excess returns on new capital):
    TV = NOPAT_(N2+1) / WACC                       # growth is value-neutral here

Moat sets N2 - N1:  wide moat ~20+ yrs of excess returns, narrow ~10 yrs, none ~0.
Financial companies: switch to FCFE discounted at r_e (FCFF ill-defined for banks).
Buy signal: required discount to fair value scales with an uncertainty rating
(e.g. low uncertainty -> buy 20% below FV; high uncertainty -> demand 30-40%+).
```

### MODEL C — Fundamentals-driven FCFF (Damodaran style)
Same engine as A/B, but inputs are forced to be internally consistent.
```
Reinvestment_t = dRevenue_t / SalesToCapital       # growth must be paid for
FCFF_t         = EBIT_t*(1 - tau) - Reinvestment_t
g              = ReinvestmentRate * ROIC           # no free growth allowed

r_e  = r_f + beta*ERP_implied + CountryRiskPremium
ERP_implied: solve for the IRR that equates today's index price to
             expected future dividends + buybacks (forward-looking, updated monthly)

Terminal constraints: g_T <= r_f (rule of thumb); firm's beta drifts toward 1.0
and cost of capital toward the mature-company average by the terminal year.
```

### MODEL D — Dividend Discount Models (banks, insurers, mature payers)
```
Gordon (single stage):     P0 = D1 / (r_e - g) = D0*(1+g) / (r_e - g)

Two-stage:                 P0 = SUM_{t=1..N} [ D0*(1+g_S)^t / (1+r_e)^t ]
                                + [ D_N*(1+g_L) / (r_e - g_L) ] / (1+r_e)^N

H-model (linear fade from g_S to g_L over 2H years):
                           P0 = [ D0*(1+g_L) + D0*H*(g_S - g_L) ] / (r_e - g_L)
```

### MODEL E — Residual Income / EVA (accounting-based intrinsic value)
Value = book value today + PV of all future economic profit.
```
RI_t = NetIncome_t - r_e * B_(t-1) = (ROE_t - r_e) * B_(t-1)
V0   = B0 + SUM_t [ RI_t / (1+r_e)^t ]
B_t  = B_(t-1) + NetIncome_t - Dividends_t          # clean surplus relation

Firm-level twin (EVA):
EVA_t = NOPAT_t - WACC * InvestedCapital_(t-1)
EV    = InvestedCapital_0 + SUM_t [ EVA_t / (1+WACC)^t ]
```
Great for financials and for companies where book value is meaningful.
Less of the value sits in the terminal term than in a DCF — more robust.

### MODEL F — Relative valuation / comps (investment-bank market anchor)
```
Implied EV     = median(EV/EBITDA)_peers * EBITDA_target
ImpliedEquity  = Implied EV + Cash - Debt
Implied price  = median(P/E)_peers * EPS_target

Precedent transactions: same math on past M&A deal multiples,
but these embed a CONTROL PREMIUM of ~20-40%, so they price higher
than trading comps. Typical ordering: precedents > DCF > trading comps.

Justified multiples (link comps back to DCF logic via Gordon):
P/E_forward  = payout / (r_e - g)
P/E_trailing = payout*(1+g) / (r_e - g)
P/B          = (ROE - g) / (r_e - g)
PEG          = (P/E) / (100*g)        # heuristic; <1 traditionally "cheap"
```

### MODEL G — Classic heuristics
```
Graham (revised, 1974):    V = EPS * (8.5 + 2*g) * 4.4 / Y
   g = expected 7-10yr growth rate as a whole number (7% -> 7)
   Y = current AAA corporate bond yield in % (e.g. 5.1)
   Graham himself later warned against formula-based valuation — use as a toy tier.

Earnings Power Value (Greenwald, zero-growth check):
   EPV_operations = NormalizedEBIT * (1 - tau) / WACC
   EPV_equity     = EPV_operations + Cash - Debt
   Compare EPV vs asset reproduction value vs market price.
```

### MODEL H — Reverse DCF (the market-expectations lens)
Instead of assumptions -> value, invert: price -> implied assumptions.
```
Solve for g* such that:  FairValue(g*, r, g_T, ...) = P_market
Use bisection/Newton on g1 (or on r for implied return).
Player decision: "Market implies g* = 14%/yr for 5 years. Believable?"
```

---

## 3. Suggested parameter ranges (simulator sliders)

| Parameter | Typical range | Notes |
|---|---|---|
| Discount rate r | 6% - 15% | 8-10% standard large-cap; 12-15% risky/small |
| Risk-free rate r_f | market 10y yield | anchor for CAPM |
| ERP | 4% - 5.5% | implied ERP updated monthly by Damodaran |
| Beta | 0.5 - 2.0 | drift toward 1.0 in terminal stage |
| Stage-1 growth g1 | -5% to 25% | analyst estimates for 5 yrs |
| Stage-2 growth g2 | ~ g1 / 2 | transition toward g_T |
| Terminal growth g_T | 2% - 3% (cap 4%) | must be < r; roughly GDP/inflation |
| Forecast N | 5 - 15 yrs | 10 is standard |
| Fade horizon (Model B) | 0 - 15 yrs extra | wide moat 20+, narrow 10, none 0 |
| Control premium | 20% - 40% | precedent transactions only |
| MoS to "buy" | 20% - 40% | scale with uncertainty rating |

---

## 4. Guardrails (enforce these in the game engine)

```
1. HARD:  g_T < r                      else TV is negative/infinite (divide by ~0)
2. HARD:  r > 0, S > 0
3. SOFT:  g_T <= 0.04                  no firm outgrows the economy forever
4. WARN:  TV_share = PV(TV)/EV > 0.85  valuation is "all terminal value"
5. WARN:  g > ReinvestmentRate * ROIC  growth not funded (Model C logic)
6. SANITY: cross-check DCF result vs peer P/E and EV/EBITDA (Model F)
7. UX:    always show a sensitivity grid FairValue(r, g_T) —
          +/-1% in either input can swing value by 20-40%+
```

---

## 5. Minimal reference implementation (Model A core engine)

```python
def fair_value(fcf0, g1, g2, gt, r, cash, debt, shares, n1=5, n2=10):
    assert r > gt, "terminal growth must be below discount rate"
    pv, fcf = 0.0, fcf0
    for t in range(1, n2 + 1):
        fcf *= (1 + (g1 if t <= n1 else g2))
        pv  += fcf / (1 + r) ** t
    tv   = fcf * (1 + gt) / (r - gt)
    pv  += tv / (1 + r) ** n2
    equity = pv + cash - debt
    return equity / shares

def implied_growth(price, solve_between=(-0.5, 0.6), **kw):
    lo, hi = solve_between                       # Model H: reverse DCF via bisection
    for _ in range(100):
        mid = (lo + hi) / 2
        if fair_value(g1=mid, g2=mid / 2, **kw) < price: lo = mid
        else: hi = mid
    return (lo + hi) / 2
```

---

## 6. Which model for which company (routing table)

| Company type | Primary model | Why |
|---|---|---|
| Stable cash generator (consumer, tech) | A or B | predictable FCF |
| High-growth, heavy reinvestment | C | growth must be funded |
| Bank / insurer | D or E | FCF ill-defined; use dividends/equity |
| Cyclical / commodity | G (EPV) + normalized A | smooth the cycle first |
| Pre-profit startup | none of these | VC methods; exclude or special-case |
| Any public company | F as cross-check | market anchor for scoring |
