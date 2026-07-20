// Savings-pool gauge (Plotly Indicator) — port of src/app/figures/goals.py.
// Shows the current pooled savings balance against the pooled target (Emergency
// Fund + highest ticked goal). Pure: theme colours + all composed strings come
// in via opts, so there's no i18n dependency here.
const SAVING_COLOR = '#3498db'
type Dict = Record<string, unknown>

export interface GaugeOpts {
  balance: number
  pooledTarget: number
  currency: string
  censor: boolean
  ink: string
  bands: [string, string, string] // low → high background bands
  title: string // "Savings Pool"
  subtitle: string // goal names (+ target), already composed & masked
  footer: string // "% funded · Emergency Fund covers N months" (or just "% funded")
}

export function buildGoalGauge(opts: GaugeOpts) {
  const { balance, currency, censor, ink, bands, title, subtitle, footer } = opts
  const pooledTarget = Math.max(opts.pooledTarget, 1)

  return {
    data: [
      {
        type: 'indicator',
        mode: censor ? 'gauge' : 'gauge+number+delta',
        value: balance,
        delta: { reference: pooledTarget, valueformat: ',.0f' },
        number: { suffix: ` ${currency}`, valueformat: ',.0f' },
        title: { text: `${title}<br><span style="font-size:0.8em;opacity:0.7">${subtitle}</span>` },
        gauge: {
          axis: { range: [0, pooledTarget], visible: !censor },
          bar: { color: SAVING_COLOR },
          steps: [
            { range: [0, pooledTarget * 0.33], color: bands[0] },
            { range: [pooledTarget * 0.33, pooledTarget * 0.66], color: bands[1] },
            { range: [pooledTarget * 0.66, pooledTarget], color: bands[2] },
          ],
          threshold: { line: { color: 'green', width: 4 }, thickness: 0.75, value: pooledTarget },
        },
      },
    ] as Dict[],
    layout: {
      height: 340,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 96, b: 44, l: 26, r: 26 },
      font: { color: ink },
      annotations: [{ text: footer, x: 0.5, y: -0.04, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 13, color: ink } }],
    } as Dict,
  }
}

// Background bands for the gauge (low → high), matching theme.gauge_bands.
export function gaugeBands(dark: boolean): [string, string, string] {
  return dark ? ['#54393b', '#54482e', '#2e4a3a'] : ['#fadbd8', '#fdebd0', '#d5f5e3']
}
