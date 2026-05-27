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

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
const PRIORITIES = ['low', 'medium', 'high'] as const
const CATEGORIES = [
  'booking',
  'payment',
  'experience',
  'account',
  'cancellation',
  'other',
] as const

interface TicketFiltersProps {
  currentFilters: {
    status?: string
    priority?: string
    category?: string
  }
}

export function TicketFilters({ currentFilters }: TicketFiltersProps) {
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
      router.push(`/admin/support?${params.toString()}`)
    },
    [router, searchParams],
  )

  const clearFilters = useCallback(() => {
    router.push('/admin/support')
  }, [router])

  const hasFilters = Object.values(currentFilters).some(Boolean)

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
              {s.replace(/_/g, ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentFilters.priority ?? 'all'}
        onValueChange={(v) => updateFilter('priority', v)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All priorities</SelectItem>
          {PRIORITIES.map((p) => (
            <SelectItem key={p} value={p} className="capitalize">
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentFilters.category ?? 'all'}
        onValueChange={(v) => updateFilter('category', v)}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {CATEGORIES.map((c) => (
            <SelectItem key={c} value={c} className="capitalize">
              {c}
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
