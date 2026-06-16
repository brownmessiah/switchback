import { Skeleton } from '@/components/ui/skeleton'

export default function VendorDashboardLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-8 w-48" />
      {/* Stat cards — mirror the page's 1 → 3 (md:) KPI grid. */}
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      {/* Trend charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl" />
      </div>
      {/* Upcoming bookings */}
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
