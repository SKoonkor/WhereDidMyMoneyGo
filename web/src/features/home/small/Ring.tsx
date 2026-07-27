// A CSS ring gauge for the small preview tiles: a conic-gradient disc with the
// middle masked out. Cheaper and much crisper than a shrunken Plotly donut at
// ~108px, and it re-themes for free because the track colour is a CSS variable.
export function Ring({
  pct, color, label, ariaLabel,
}: {
  /** 0-100; clamped. */
  pct: number
  /** CSS colour for the filled arc. */
  color: string
  /** Text drawn in the hole. */
  label: string
  ariaLabel: string
}) {
  const p = Math.min(100, Math.max(0, pct))
  return (
    <div className="mini-ring" role="img" aria-label={ariaLabel}>
      {/* The mask that punches out the hole applies to descendants too, so the
          disc and the label have to be siblings. */}
      <div
        className="mini-ring-disc"
        style={{ ['--ring-pct' as string]: `${p}%`, ['--ring-color' as string]: color }}
      />
      <span className="mini-ring-label">{label}</span>
    </div>
  )
}
