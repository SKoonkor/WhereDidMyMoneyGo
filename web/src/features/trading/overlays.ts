// Which indicators the chart offers, and what each one is made of.
//
// Its own module rather than a couple of exports beside `ChartPanel`, because a
// file that exports both a component and a constant loses Fast Refresh for the
// whole file — the settings sheet reads the list, so it would otherwise force a
// full reload of the chart on every edit.
//
// PRICE-SCALE overlays only. `createIndicatorLayer` draws into the main plot
// against the price axis and has no sub-pane concept — `IndicatorSeries` carries
// no `pane` field — so an oscillator like RSI, which lives on 0..100, would be
// drawn thousands of price units below the candles and simply never appear. It is
// left out rather than shipped invisible; adding it means a second pane in the
// renderer, not an entry in this table.
//
// VWAP is left out for a related reason: `VwapIndicator` takes price AND volume
// per sample, so it does not satisfy the one-argument `Indicator` shape this table
// is built on, and bending the table to fit one member would cost more than it
// buys. Kept short on purpose besides — six overlays on a phone plot is a mess,
// and the ones people actually read are a fast average and a slow one.

import { ema, sma, type Indicator } from '../../lib/trading/indicators'

export interface OverlayDef {
  period: number
  make: (period: number, cap: number) => Indicator
  /** Which of the theme's own colours it takes. §E allows exactly two new tokens
   *  and an indicator palette is not one of them, so these are app tokens. */
  tone: 'accent' | 'muted'
  label: string
}

export const INDICATOR_DEFS: Record<string, OverlayDef> = {
  'sma-20': { period: 20, make: sma, tone: 'accent', label: 'SMA 20' },
  'sma-50': { period: 50, make: sma, tone: 'muted', label: 'SMA 50' },
  'ema-9': { period: 9, make: ema, tone: 'accent', label: 'EMA 9' },
  'ema-21': { period: 21, make: ema, tone: 'muted', label: 'EMA 21' },
}

export const INDICATOR_IDS = Object.keys(INDICATOR_DEFS)

/** How much of an indicator's ring is addressable. Beyond this the value for an
 *  old bar has been overwritten and the honest answer is NaN. */
export const IND_CAP = 4096
