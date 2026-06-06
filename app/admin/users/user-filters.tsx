'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { UserRole } from '@/lib/admin/users-list'

interface UserFiltersProps {
  currentFilters: {
    query?: string
    role?: string
  }
}

const ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: 'customer', label: 'Customer' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'admin', label: 'Admin' },
  { value: 'sub_admin', label: 'Sub-admin' },
]

/**
 * #17 — querystring-driven search + role filter for `/admin/users`, mirroring
 * the audit-log filter pattern. The search box submits on Enter / blur so the
 * URL stays shareable; the role select applies immediately. Changing any
 * filter resets pagination to page 1.
 */
export function UserFilters({ currentFilters }: UserFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [queryValue, setQueryValue] = useState(currentFilters.query ?? '')

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
      const qs = params.toString()
      router.push(`/admin/users${qs ? `?${qs}` : ''}`)
    },
    [router, searchParams],
  )

  const clearFilters = useCallback(() => {
    setQueryValue('')
    router.push('/admin/users')
  }, [router])

  const hasFilters = Boolean(currentFilters.query || currentFilters.role)

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Search */}
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              applyFilter('query', queryValue.trim())
            }}
          >
            <Label htmlFor="filter-query" className="text-xs font-medium">
              Search
            </Label>
            <Input
              id="filter-query"
              type="search"
              placeholder="Name or email"
              value={queryValue}
              onChange={(e) => setQueryValue(e.target.value)}
              onBlur={() => {
                if (queryValue.trim() !== (currentFilters.query ?? '')) {
                  applyFilter('query', queryValue.trim())
                }
              }}
            />
          </form>

          {/* Role filter */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-role" className="text-xs font-medium">
              Role
            </Label>
            <select
              id="filter-role"
              className="min-tap flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={currentFilters.role ?? ''}
              onChange={(e) => applyFilter('role', e.target.value)}
            >
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
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
