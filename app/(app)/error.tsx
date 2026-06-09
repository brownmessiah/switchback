'use client'

import { SegmentError } from '@/components/segment-error'

/**
 * Segment error boundary for the authenticated (app) group — dashboard,
 * bookings, checkout, wallet, wishlist, support (issue 25). A network/load
 * failure here degrades to the shared, recoverable SegmentError panel (with a
 * retry) instead of a blank crash. The (app) group has no own layout, so this
 * provides its own page padding.
 */
export default function AppSegmentError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col px-4 py-16 sm:px-6">
      <SegmentError reset={reset} />
    </main>
  )
}
