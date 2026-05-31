import type { ReactElement } from 'react'

/**
 * SettingsAnchorNav — sticky in-page jump nav for the single-scroll Vendor
 * settings page (#56 Direction B "Single-scroll trust ledger", DESIGN.md §4).
 *
 * A presentational Server Component: plain same-page hash links, no client
 * interactivity (mirrors the PDP `anchor-nav`). It sticks below the site header
 * while the content column scrolls. Each link targets a section `id` rendered
 * on the page; the `scroll-mt` on those sections keeps the heading clear of the
 * site header after a jump. Wayfinding links are structural, not status, so no
 * status-color/icon pairing is needed — styled on `--primary-strong` (coral as
 * AA-safe text, DESIGN.md §2.1 / §5).
 */

export interface SettingsAnchorNavItem {
  /** Fragment id of the target section (without `#`). */
  id: string
  /** User-facing label. */
  label: string
}

interface SettingsAnchorNavProps {
  /** Accessible name for the nav landmark. */
  label: string
  items: ReadonlyArray<SettingsAnchorNavItem>
}

export function SettingsAnchorNav({
  label,
  items,
}: SettingsAnchorNavProps): ReactElement {
  return (
    <nav
      aria-label={label}
      className="sticky top-[var(--header-offset,4rem)] z-20 mb-4 self-start border-b border-border bg-surface-0/85 py-2 backdrop-blur supports-[backdrop-filter]:bg-surface-0/70 lg:mb-0 lg:border-0 lg:bg-transparent lg:py-0 lg:backdrop-blur-none lg:supports-[backdrop-filter]:bg-transparent"
    >
      <ul className="scrollbar-none flex items-center gap-1 overflow-x-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible">
        {items.map((item) => (
          <li key={item.id} className="shrink-0 lg:shrink">
            <a
              href={`#${item.id}`}
              className="inline-flex w-full items-center rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
