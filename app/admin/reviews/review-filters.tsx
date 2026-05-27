'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const STATUSES = ['pending', 'published', 'flagged', 'removed'] as const
const RATINGS = [1, 2, 3, 4, 5] as const

interface ReviewFiltersProps {
  currentFilters: {
    rating?: number
    status?: string
  }
}

export function ReviewFilters({ currentFilters }: ReviewFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateFilter = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      router.push(`/admin/reviews?${params.toString()}`)
    },
    [router, searchParams],
  )

  const clearFilters = useCallback(() => {
    router.push('/admin/reviews')
  }, [router])

  const hasFilters =
    currentFilters.rating !== undefined || currentFilters.status !== undefined

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={currentFilters.status ?? 'all'}
        onValueChange={(v) => updateFilter('status', v)}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="capitalize">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentFilters.rating !== undefined ? String(currentFilters.rating) : 'all'}
        onValueChange={(v) => updateFilter('rating', v)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Rating" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All ratings</SelectItem>
          {RATINGS.map((r) => (
            <SelectItem key={r} value={String(r)}>
              {'★'.repeat(r)}{'☆'.repeat(5 - r)} ({r})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  )
}
