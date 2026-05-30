import { Skeleton } from '@/components/ui/skeleton'

export default function SearchLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Mobile Filters trigger placeholder */}
      <Skeleton className="mb-6 h-9 w-28 lg:hidden" />

      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Left filter rail skeleton (desktop only) */}
        <div className="hidden space-y-4 lg:block">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>

        {/* Results grid skeleton */}
        <div className="grid min-w-0 gap-[var(--space-grid-gap)] sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-[var(--radius-card)]" />
          ))}
        </div>
      </div>
    </main>
  )
}
