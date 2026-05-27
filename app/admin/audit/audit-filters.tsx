'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuditFiltersProps {
  entityTypes: string[]
  actions: string[]
  currentFilters: {
    entityType?: string
    action?: string
    actorUserId?: string
    dateFrom?: string
    dateTo?: string
  }
}

export function AuditFilters({
  entityTypes,
  actions,
  currentFilters,
}: AuditFiltersProps) {
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
      // Reset to page 1 when filters change
      params.delete('page')
      router.push(`/admin/audit?${params.toString()}`)
    },
    [router, searchParams],
  )

  const clearFilters = useCallback(() => {
    router.push('/admin/audit')
  }, [router])

  const hasFilters = Object.values(currentFilters).some(Boolean)

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* Entity type filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-entity-type" className="text-xs font-medium">
              Target Type
            </Label>
            <select
              id="filter-entity-type"
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={currentFilters.entityType ?? ''}
              onChange={(e) => applyFilter('entityType', e.target.value)}
            >
              <option value="">All types</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Action filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-action" className="text-xs font-medium">
              Action
            </Label>
            <select
              id="filter-action"
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={currentFilters.action ?? ''}
              onChange={(e) => applyFilter('action', e.target.value)}
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Actor filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-actor" className="text-xs font-medium">
              Actor ID
            </Label>
            <Input
              id="filter-actor"
              type="text"
              placeholder="User ID"
              value={currentFilters.actorUserId ?? ''}
              onChange={(e) => applyFilter('actorUserId', e.target.value)}
            />
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
