'use client'

import { Filter, ArrowUpDown } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { cn } from '@/lib/utils'

import {
  LISTING_SORTS,
  LISTING_STATUS_FILTERS,
  type ListingSort,
  type ListingStatusFilter,
} from './listings-options'

interface ListingsControlsProps {
  /** Current status filter (derived from searchParams on the server). */
  status: ListingStatusFilter
  /** Current sort (derived from searchParams on the server). */
  sort: ListingSort
}

const selectClassName = cn(
  'min-tap h-9 rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-xs',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
  'appearance-none cursor-pointer',
)

/**
 * Small client island for the listings index filter + sort (#75 variant A).
 * URL-driven: each control writes its value to the query string via the
 * router, and the Server Component re-runs the (filtered, sorted) read. The
 * controls initialise from the current URL the server already rendered — no
 * `Date.now()` / client-only seed — so there is no hydration mismatch.
 */
export function ListingsControls({ status, sort }: ListingsControlsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string, defaultValue: string): void {
    const params = new URLSearchParams(searchParams.toString())
    if (value === defaultValue) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Filter
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor="listing-status-filter" className="sr-only">
          Filter listings by status
        </label>
        <select
          id="listing-status-filter"
          data-testid="listing-status-filter"
          className={selectClassName}
          value={status}
          onChange={(e) => setParam('status', e.target.value, 'all')}
        >
          {LISTING_STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <ArrowUpDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor="listing-sort" className="sr-only">
          Sort listings
        </label>
        <select
          id="listing-sort"
          data-testid="listing-sort"
          className={selectClassName}
          value={sort}
          onChange={(e) => setParam('sort', e.target.value, 'created_desc')}
        >
          {LISTING_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
