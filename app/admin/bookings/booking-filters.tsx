'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { BookingListFilters } from './loaders'

const BOOKING_STATES = [
  { value: '', label: 'All states' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'awaiting_completion', label: 'Awaiting Completion' },
  { value: 'completed', label: 'Completed' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'cancelled_by_customer', label: 'Cancelled by Customer' },
  { value: 'cancelled_by_vendor', label: 'Cancelled by Vendor' },
  { value: 'cancelled_post_experience', label: 'Cancelled Post-Experience' },
]

interface BookingFiltersProps {
  currentFilters: BookingListFilters
  vendors: ReadonlyArray<{ userId: string; businessName: string }>
  experiences: ReadonlyArray<{ id: string; title: string }>
}

export function BookingFilters({
  currentFilters,
  vendors,
  experiences,
}: BookingFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const applyFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`/admin/bookings?${params.toString()}`)
    },
    [router, searchParams],
  )

  const clearFilters = useCallback(() => {
    router.push('/admin/bookings')
  }, [router])

  const hasFilters = Object.values(currentFilters).some(Boolean)

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* State filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-state" className="text-xs font-medium">
              State
            </Label>
            <select
              id="filter-state"
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={currentFilters.state ?? ''}
              onChange={(e) => applyFilter('state', e.target.value)}
            >
              {BOOKING_STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-date-from" className="text-xs font-medium">
              From Date
            </Label>
            <Input
              id="filter-date-from"
              type="date"
              value={currentFilters.dateFrom ?? ''}
              onChange={(e) => applyFilter('dateFrom', e.target.value)}
            />
          </div>

          {/* Date to */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-date-to" className="text-xs font-medium">
              To Date
            </Label>
            <Input
              id="filter-date-to"
              type="date"
              value={currentFilters.dateTo ?? ''}
              onChange={(e) => applyFilter('dateTo', e.target.value)}
            />
          </div>

          {/* Vendor filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-vendor" className="text-xs font-medium">
              Vendor
            </Label>
            <select
              id="filter-vendor"
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={currentFilters.vendorUserId ?? ''}
              onChange={(e) => applyFilter('vendor', e.target.value)}
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.userId} value={v.userId}>
                  {v.businessName}
                </option>
              ))}
            </select>
          </div>

          {/* Experience filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-experience" className="text-xs font-medium">
              Experience
            </Label>
            <select
              id="filter-experience"
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={currentFilters.experienceId ?? ''}
              onChange={(e) => applyFilter('experience', e.target.value)}
            >
              <option value="">All experiences</option>
              {experiences.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasFilters && (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
