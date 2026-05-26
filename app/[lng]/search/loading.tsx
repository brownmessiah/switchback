import { Skeleton } from '@/components/ui/skeleton'

export default function SearchLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <Skeleton className="mb-8 h-10 w-64" />
      <div className="grid gap-8 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 lg:col-span-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    </main>
  )
}
