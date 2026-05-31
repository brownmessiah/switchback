import type { ReactElement } from 'react'

/**
 * AnchorNav — Viator-grade in-page jump nav for the Experience PDP
 * (Direction B "Conversion-dense sticky-rail", #65 / DESIGN.md §4 B2).
 *
 * A presentational Server Component: plain same-page hash links, no client
 * interactivity. It sticks below the site header while the left content column
 * scrolls. Each link targets a section `id` rendered in the left column; the
 * `scroll-mt` on those sections (set on the page) keeps the heading clear of
 * the sticky bar after a jump.
 *
 * Status is structural, not semantic, so no status-color/icon pairing is needed
 * here — these are wayfinding links, styled on `--primary-strong` (coral as
 * AA-safe text, DESIGN.md §2.1 / §5) for the hover/active affordance.
 */

export interface AnchorNavItem {
  /** Fragment id of the target section in the left column (without `#`). */
  id: string
  /** Already-translated, user-facing label. */
  label: string
}

interface AnchorNavProps {
  /** Accessible name for the nav landmark (already translated). */
  label: string
  items: ReadonlyArray<AnchorNavItem>
}

export function AnchorNav({ label, items }: AnchorNavProps): ReactElement {
  return (
    <nav
      aria-label={label}
      className="sticky top-[var(--header-offset,4rem)] z-20 -mx-4 mb-[var(--space-section)] border-b border-border bg-surface-0/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface-0/70 sm:-mx-6 sm:px-6"
    >
      <ul className="scrollbar-none flex items-center gap-1 overflow-x-auto py-2">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              className="inline-flex items-center rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
