'use client'

import { SegmentError } from '@/components/segment-error'

/**
 * Segment error boundary for the Vendor dashboard group (issue 25). A
 * network/load failure (e.g. the dashboard loader) degrades to the shared,
 * recoverable SegmentError panel with a retry instead of a blank crash. The
 * dashboard layout already supplies the <main> padding, so this only needs the
 * panel.
 */
export default function VendorDashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="py-8">
      <SegmentError reset={reset} />
    </div>
  )
}
