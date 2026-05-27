import type { ReactElement } from 'react'

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

import { ExperienceActionsCell } from './experience-actions-cell'

// ── Filter constants ────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
] as const

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  pending_review: 'secondary',
  published: 'default',
  paused: 'secondary',
  archived: 'destructive',
}

// ── Param parsing ───────────────────────────────────────────────────

interface ParsedFilters {
  status: string | undefined
  category: string | undefined
  region: string | undefined
  vendor: string | undefined
  minPrice: number | undefined
  maxPrice: number | undefined
}

function parseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ParsedFilters {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v

  const minPriceStr = first(raw.minPrice)
  const maxPriceStr = first(raw.maxPrice)

  return {
    status: first(raw.status),
    category: first(raw.category),
    region: first(raw.region),
    vendor: first(raw.vendor),
    minPrice: minPriceStr ? Number(minPriceStr) : undefined,
    maxPrice: maxPriceStr ? Number(maxPriceStr) : undefined,
  }
}

// ── Page ────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AdminExperiencesPage({
  searchParams,
}: PageProps): Promise<ReactElement> {
  const rawParams = await searchParams
  const filters = parseSearchParams(rawParams)

  // Build where conditions
  const conditions = []

  if (filters.status && filters.status !== 'all') {
    conditions.push(
      eq(
        experiences.status,
        filters.status as 'draft' | 'pending_review' | 'published' | 'paused' | 'archived',
      ),
    )
  }

  if (filters.category && filters.category !== 'all') {
    conditions.push(eq(experiences.activitySlug, filters.category))
  }

  if (filters.region && filters.region !== 'all') {
    conditions.push(eq(experiences.regionSlug, filters.region))
  }

  if (filters.vendor && filters.vendor !== 'all') {
    conditions.push(eq(experiences.vendorUserId, filters.vendor))
  }

  if (filters.minPrice !== undefined) {
    conditions.push(
      gte(experiences.pricePerPerson_1_2, filters.minPrice.toFixed(2)),
    )
  }

  if (filters.maxPrice !== undefined) {
    conditions.push(
      lte(experiences.pricePerPerson_1_2, filters.maxPrice.toFixed(2)),
    )
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Query: pending_review first, then by createdAt desc
  const rows = await db
    .select({
      id: experiences.id,
      title: experiences.title,
      slug: experiences.slug,
      status: experiences.status,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      vendorUserId: experiences.vendorUserId,
      vendorBusinessName: vendorProfiles.businessName,
      createdAt: experiences.createdAt,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(whereClause)
    .orderBy(
      // pending_review first (0), then everything else (1)
      asc(sql`CASE WHEN ${experiences.status} = 'pending_review' THEN 0 ELSE 1 END`),
      desc(experiences.createdAt),
    )

  // Derive distinct values for filter dropdowns
  const categories = [...new Set(rows.map((r) => r.activitySlug))].sort()
  const regions = [...new Set(rows.map((r) => r.regionSlug))].sort()
  const vendors = [...new Map(
    rows.map((r) => [r.vendorUserId, r.vendorBusinessName]),
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const pendingCount = rows.filter((r) => r.status === 'pending_review').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Experience Moderation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} experience{rows.length === 1 ? '' : 's'}
          {pendingCount > 0 && (
            <span className="ml-2 font-medium text-amber-600">
              ({pendingCount} pending review)
            </span>
          )}
        </p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-6">
          <form method="get" action="/admin/experiences" className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={filters.status ?? 'all'}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select name="category" defaultValue={filters.category ?? 'all'}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replaceAll('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="region">Region</Label>
              <Select name="region" defaultValue={filters.region ?? 'all'}>
                <SelectTrigger id="region">
                  <SelectValue placeholder="All regions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All regions</SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replaceAll('-', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor">Vendor</Label>
              <Select name="vendor" defaultValue={filters.vendor ?? 'all'}>
                <SelectTrigger id="vendor">
                  <SelectValue placeholder="All vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  {vendors.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="minPrice">Min ₹</Label>
                <Input
                  id="minPrice"
                  name="minPrice"
                  type="number"
                  placeholder="0"
                  defaultValue={filters.minPrice ?? ''}
                  className="w-24"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxPrice">Max ₹</Label>
                <Input
                  id="maxPrice"
                  name="maxPrice"
                  type="number"
                  placeholder="Any"
                  defaultValue={filters.maxPrice ?? ''}
                  className="w-24"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Filter
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                formAction="/admin/experiences"
              >
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Price (1-2)</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No experiences found.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((exp) => (
                <TableRow
                  key={exp.id}
                  className={
                    exp.status === 'pending_review'
                      ? 'bg-amber-50 dark:bg-amber-950/20'
                      : undefined
                  }
                >
                  <TableCell className="max-w-[200px] truncate font-medium">
                    {exp.title}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {exp.vendorBusinessName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANTS[exp.status] ?? 'outline'}
                      className="text-xs capitalize"
                    >
                      {exp.status.replaceAll('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {exp.activitySlug.replaceAll('_', ' ')}
                  </TableCell>
                  <TableCell className="text-sm">
                    {exp.regionSlug.replaceAll('-', ' ')}
                  </TableCell>
                  <TableCell className="text-sm">
                    ₹{Number(exp.pricePerPerson_1_2).toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(exp.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </TableCell>
                  <TableCell>
                    <ExperienceActionsCell
                      experienceId={exp.id}
                      status={exp.status}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
