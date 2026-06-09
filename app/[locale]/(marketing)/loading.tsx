import { Skeleton } from '@/components/ui/skeleton'

/**
 * Home route skeleton (issue 25). Mirrors the page's cinematic hero + the
 * destinations / featured-experiences card grids so the server render never
 * shows a blank screen. Reuses the shared Skeleton primitive (DECISION D11).
 */
export default function HomeLoading() {
  return (
    <main>
      {/* Hero band */}
      <section className="relative flex min-h-[88vh] flex-col items-center justify-center gap-5 overflow-hidden bg-muted/40 px-4 pt-20 pb-12 text-center">
        <Skeleton className="h-10 w-3/4 max-w-2xl" />
        <Skeleton className="h-5 w-1/2 max-w-md" />
        <Skeleton className="h-12 w-full max-w-md rounded-[var(--radius-control)]" />
        <div className="flex flex-wrap justify-center gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-28 rounded-[var(--radius-pill)]" />
          ))}
        </div>
      </section>

      {/* Destinations grid */}
      <section className="mx-auto max-w-6xl px-4 py-[var(--space-section)] sm:px-6">
        <Skeleton className="mb-8 h-7 w-56" />
        <div className="grid grid-cols-2 gap-[var(--space-grid-gap)] md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/2] rounded-[var(--radius-card)]" />
          ))}
        </div>
      </section>

      {/* Featured experiences grid */}
      <section className="mx-auto max-w-6xl px-4 pb-[var(--space-section)] sm:px-6">
        <Skeleton className="mb-8 h-7 w-56" />
        <div className="grid grid-cols-1 gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-[var(--radius-card)]" />
          ))}
        </div>
      </section>
    </main>
  )
}
