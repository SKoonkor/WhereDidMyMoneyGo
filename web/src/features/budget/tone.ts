import type { Tone } from '../../lib/analytics/budget'

// Traffic-light colours for anything that can't take a CSS class — currently the
// conic-gradient ring in the small tiles, which needs a colour value in JS.
// Colours stay out of the pure analytics module; these mirror
// `.budget-bar-fill.good/.warn/.bad` in App.css, including its literal amber.
export const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--income)',
  warn: '#f39c12',
  bad: 'var(--expense)',
}
