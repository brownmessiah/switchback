import { Skeleton } from '@/components/ui/skeleton'

/**
 * PDP (Experience detail) route skeleton (issue 25). Mirrors the page's
 * gallery + content / sticky booking-rail two-column layout so the server
 * render never shows a blank screen. Reuses the shared Skeleton primitive.
 */
export default function ExperienceLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 lg:py-12 lg:pb-12">
      {/* Title + meta */}
      <div className="mb-6 space-y-3">
        <Skeleton className="h-9 w-3/4 max-w-2xl" />
        <Skeleton className="h-5 w-1/2 max-w-md" />
      </div>

      {/* Hero+grid gallery */}
      <div className="mb-8 grid gap-2 sm:grid-cols-[2fr_1fr]">
        <Skeleton className="aspect-[4/3] rounded-[var(--radius-card)] sm:aspect-auto sm:h-[28rem]" />
        <div className="hidden grid-rows-2 gap-2 sm:grid">
          <Skeleton className="rounded-[var(--radius-card)]" />
          <Skeleton className="rounded-[var(--radius-card)]" />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
        {/* Left content column */}
        <div className="min-w-0 space-y-6">
          <Skeleton className="h-24 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-56 w-full rounded-[var(--radius-card)]" />
        </div>

        {/* Sticky booking rail */}
        <aside className="hidden lg:block">
          <Skeleton className="h-[26rem] w-full rounded-[var(--radius-card)]" />
        </aside>
      </div>
    </main>
  )
}
