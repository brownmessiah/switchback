import { cn } from '@/lib/utils'

interface CompletenessRingProps {
  /** Completeness percentage in [0, 100]. */
  percent: number
  /** Number of filled required fields (for the accessible label). */
  filled: number
  /** Total required fields (for the accessible label). */
  total: number
}

/**
 * A small circular completeness ring (DESIGN.md §4 A3, direction A) showing
 * "% of required fields filled" for one listing. Pure SVG, token-true:
 * the track uses `--muted`; the arc maps to the semantic status family
 * (success when complete, warning mid, info low) so the signal is never
 * conveyed by an off-system color. The numeric label is `.tabular-nums`.
 *
 * A11y: the SVG carries `role="img"` + an `aria-label` stating the exact
 * fraction, and the visible "%" is `aria-hidden` to avoid double-announcing.
 */
export function CompletenessRing({ percent, filled, total }: CompletenessRingProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  const radius = 16
  const stroke = 3.5
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference

  // Map completeness onto the semantic status family (color is paired with
  // the always-present numeric label, never color-alone).
  const arcClass =
    clamped >= 100
      ? 'text-success'
      : clamped >= 60
        ? 'text-info'
        : 'text-warning'

  return (
    <span
      className="inline-flex items-center gap-2"
      data-testid="listing-completeness"
    >
      <svg
        width={42}
        height={42}
        viewBox="0 0 42 42"
        role="img"
        aria-label={`${clamped}% complete — ${filled} of ${total} required fields filled`}
        className="shrink-0 -rotate-90"
      >
        <circle
          cx={21}
          cy={21}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={21}
          cy={21}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={cn('stroke-current transition-all', arcClass)}
        />
      </svg>
      <span
        className="text-xs font-medium tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {clamped}%
      </span>
    </span>
  )
}
