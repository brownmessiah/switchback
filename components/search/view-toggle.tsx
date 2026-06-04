'use client'

import type { ReactElement } from 'react'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { LayoutGrid, List } from 'lucide-react'

import { cn } from '@/lib/utils'

export type SearchView = 'grid' | 'list'

interface ViewToggleProps {
  /** The active view (parsed from the `view` searchParam; grid is the default). */
  current: SearchView
  /** Already-translated accessible label for the grid button. */
  gridLabel: string
  /** Already-translated accessible label for the list button. */
  listLabel: string
}

/**
 * Grid/list results-layout toggle for /search (parity with outvers.com). The
 * view is URL state (`?view=list`) so it is shareable and SSR-rendered; grid is
 * the default and drops the param. `view` is a display-only param — it is NOT
 * part of `SearchExperiencesParams`, so it never affects the result set,
 * `isFilteredSearch`, or the ADR-0013 canonical/robots rules.
 */
export function ViewToggle({
  current,
  gridLabel,
  listLabel,
}: ViewToggleProps): ReactElement {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setView(view: SearchView): void {
    const sp = new URLSearchParams(searchParams.toString())
    if (view === 'grid') sp.delete('view')
    else sp.set('view', view)
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const buttonClass = (active: boolean): string =>
    cn(
      'flex size-9 items-center justify-center rounded-[var(--radius-control)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <div
      role="group"
      aria-label={`${gridLabel} / ${listLabel}`}
      data-testid="view-toggle"
      className="flex items-center gap-1 rounded-[var(--radius-control)] border border-border p-1"
    >
      <button
        type="button"
        aria-label={gridLabel}
        aria-pressed={current === 'grid'}
        onClick={() => setView('grid')}
        className={buttonClass(current === 'grid')}
      >
        <LayoutGrid className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={listLabel}
        aria-pressed={current === 'list'}
        onClick={() => setView('list')}
        className={buttonClass(current === 'list')}
      >
        <List className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
