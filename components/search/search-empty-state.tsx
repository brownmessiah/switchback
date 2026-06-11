import Link from 'next/link'
import { SearchX } from 'lucide-react'
import type { ReactElement } from 'react'

import { EmptyState } from '@/components/empty-state'

/**
 * One inventory-backed "popular alternative" link rendered under the search
 * empty state. Each href deep-links into a pre-filtered `/search` and only
 * exists because its (region, activity) pair has REAL published inventory
 * (DECISION D0) — the server resolves these from `loadPopularSearchChips`.
 */
export interface SearchEmptyAlternative {
  /** Stable React key (region:activity). */
  readonly key: string
  /** Pre-filtered `/search` URL for the pair. */
  readonly href: string
  /** Already-translated chip label, e.g. "Rishikesh Rafting". */
  readonly label: string
}

export interface SearchEmptyStateLabels {
  /** Already-translated heading (`results.empty`). */
  readonly title: string
  /** Already-translated supporting hint (`results.emptyHint`). */
  readonly hint: string
  /** Already-translated "Clear filters" CTA label (`results.clearFilters`). */
  readonly clearFilters: string
  /** Already-translated "Popular searches" eyebrow over the alternatives. */
  readonly alternativesLabel: string
  /** Already-translated "Browse nearby destinations" CTA (`results.browseDestinations`). */
  readonly browseDestinations: string
}

interface SearchEmptyStateProps {
  /** Already-translated copy. */
  labels: SearchEmptyStateLabels
  /** True when at least one filter/query narrows the search (ADR-0013). */
  isFiltered: boolean
  /** Inventory-backed popular alternatives (empty → no alternatives block). */
  alternatives: ReadonlyArray<SearchEmptyAlternative>
}

/**
 * The polished zero-results state for `/search` (issue 25 / DECISION D11+D0).
 *
 * Reuses the shared `EmptyState` shell (icon + heading + hint) and gives the
 * Customer a CLEAR next action instead of a dead dashed box:
 *   1. "Clear filters" → bare `/search` (only when the search is filtered, so an
 *      already-unfiltered empty result doesn't offer a no-op).
 *   2. Inventory-backed "Popular searches" — deep links into pre-filtered
 *      `/search` that are guaranteed to have live published inventory (never a
 *      dead 0-result link, D0). The block is omitted entirely when there is no
 *      live inventory to suggest.
 *
 * Presentational + server-friendly (no client hooks): the page resolves the
 * translations and the inventory-backed chips, mirroring the BookingRail pattern.
 */
export function SearchEmptyState({
  labels,
  isFiltered,
  alternatives,
}: SearchEmptyStateProps): ReactElement {
  return (
    <EmptyState
      data-testid="search-empty"
      icon={SearchX}
      title={labels.title}
      description={labels.hint}
      cta={isFiltered ? { href: '/search', label: labels.clearFilters } : undefined}
    >
      {alternatives.length > 0 ? (
        <div className="mt-6 w-full max-w-md">
          <p className="mb-2 text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
            {labels.alternativesLabel}
          </p>
          <ul className="flex flex-wrap justify-center gap-2">
            {alternatives.map((alt) => (
              <li key={alt.key}>
                <Link
                  href={alt.href}
                  data-testid="search-empty-alternative"
                  className="min-tap inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] border border-border bg-surface-0 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {alt.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Always-on browse path (QA fix pass): even with no live alternatives
          a dead-end search keeps a way out. */}
      <div className="mt-4">
        <Link
          href="/destinations"
          data-testid="search-empty-browse-destinations"
          className="min-tap inline-flex items-center text-sm font-medium text-primary underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {labels.browseDestinations}
        </Link>
      </div>
    </EmptyState>
  )
}
