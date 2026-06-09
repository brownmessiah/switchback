import type { ReactElement } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared loading skeleton for the destination + activity collection pages
 * (issue 25). Both pages share the same shape — a 2-column editorial hero
 * (`[1.1fr_1fr]` with an aspect image) above an Experience card grid
 * (`md:grid-cols-2 lg:grid-cols-3`) — so they reuse one skeleton instead of
 * duplicating it. Reuses the shared Skeleton primitive (DECISION D11).
 */
export function CollectionPageSkeleton(): ReactElement {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {/* Editorial hero */}
      <header className="mb-[var(--space-section)]">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-2/3" />
          </div>
          <Skeleton className="aspect-[4/3] rounded-[var(--radius-card)] lg:aspect-[5/4]" />
        </div>
      </header>

      {/* Experiences grid */}
      <section>
        <Skeleton className="mb-6 h-7 w-64" />
        <div className="grid gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-[var(--radius-card)]" />
          ))}
        </div>
      </section>
    </main>
  )
}
