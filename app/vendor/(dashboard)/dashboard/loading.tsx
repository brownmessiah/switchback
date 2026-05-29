import { Skeleton } from '@/components/ui/skeleton'

export default function VendorDashboardLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-8 w-48" />
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      {/* Trend charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl" />
      </div>
      {/* Action items */}
      <Skeleton className="h-48 rounded-xl" />
      {/* Upcoming bookings */}
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
