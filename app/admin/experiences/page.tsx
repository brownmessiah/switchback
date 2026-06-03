import type { ReactElement } from 'react'

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'

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
import { experienceItinerarySteps } from '@/db/schema/experience-itinerary-steps'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { formatDuration, formatSeason } from '@/lib/experiences/structured-schema'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { formatRupees } from '../_components/money'
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

// Human labels for the semantic AdminStatusBadge (color + icon supplied by the
// shared STATUS_MAP — DESIGN.md §4 A3 / §5). Admin is English-only (no i18n).
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  published: 'Published',
  paused: 'Paused',
  archived: 'Archived',
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
  // ADR-0017 — itinerary step count per Experience (read-only moderation
  // signal). A correlated COUNT keeps the moderation query a single round-trip.
  const itineraryStepCount = sql<number>`(
    SELECT COUNT(*)::int FROM ${experienceItinerarySteps}
    WHERE ${experienceItinerarySteps.experienceId} = ${experiences.id}
  )`

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
      // ADR-0017 structured attributes — surfaced read-only for moderation.
      difficulty: experiences.difficulty,
      durationMinutes: experiences.durationMinutes,
      minAge: experiences.minAge,
      maxGroupSize: experiences.maxGroupSize,
      languages: experiences.languages,
      meetingPoint: experiences.meetingPoint,
      seasonMonths: experiences.seasonMonths,
      highlights: experiences.highlights,
      inclusions: experiences.inclusions,
      exclusions: experiences.exclusions,
      whatToBring: experiences.whatToBring,
      itineraryStepCount,
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
            <caption className="sr-only">Experience moderation queue</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Title</TableHead>
                <TableHead scope="col">Vendor</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Category</TableHead>
                <TableHead scope="col">Region</TableHead>
                <TableHead scope="col" className="text-right">
                  Price (1-2)
                </TableHead>
                <TableHead scope="col">Attributes</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
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
                    <AdminStatusBadge
                      status={exp.status}
                      label={STATUS_LABEL[exp.status] ?? exp.status.replaceAll('_', ' ')}
                    />
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {exp.activitySlug.replaceAll('_', ' ')}
                  </TableCell>
                  <TableCell className="text-sm">
                    {exp.regionSlug.replaceAll('-', ' ')}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {formatRupees(exp.pricePerPerson_1_2)}
                  </TableCell>
                  <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                    <StructuredAttributesCell exp={exp} />
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

// ── ADR-0017 read-only structured-attribute summary (moderation) ─────────────

interface StructuredAttributesCellProps {
  exp: {
    difficulty: string | null
    durationMinutes: number | null
    minAge: number | null
    maxGroupSize: number | null
    languages: string[] | null
    meetingPoint: string | null
    seasonMonths: number[] | null
    highlights: string[] | null
    inclusions: string[] | null
    exclusions: string[] | null
    whatToBring: string[] | null
    itineraryStepCount: number
  }
}

/**
 * Compact, read-only rendering of the ADR-0017 structured attributes for the
 * moderation queue. Additive — no mutations. Duration uses the shared
 * formatDuration roll-up and season uses formatSeason (same helpers the PDP
 * uses), so the admin sees exactly what a Customer would. Empty/NULL facets
 * are simply omitted; a fully-bare Experience shows an em-dash.
 */
function StructuredAttributesCell({ exp }: StructuredAttributesCellProps): ReactElement {
  const facets: string[] = []
  if (exp.durationMinutes != null) facets.push(formatDuration(exp.durationMinutes))
  if (exp.difficulty) facets.push(exp.difficulty)
  if (exp.minAge != null) facets.push(`${exp.minAge}+ yrs`)
  if (exp.maxGroupSize != null) facets.push(`max ${exp.maxGroupSize}`)
  const season = exp.seasonMonths && exp.seasonMonths.length > 0 ? formatSeason(exp.seasonMonths) : ''
  if (season) facets.push(season)

  const languages = exp.languages ?? []
  const highlights = exp.highlights ?? []
  const inclusions = exp.inclusions ?? []
  const exclusions = exp.exclusions ?? []
  const whatToBring = exp.whatToBring ?? []

  const counts: string[] = []
  if (highlights.length > 0) counts.push(`${highlights.length} highlights`)
  if (inclusions.length > 0) counts.push(`${inclusions.length} inclusions`)
  if (exclusions.length > 0) counts.push(`${exclusions.length} exclusions`)
  if (whatToBring.length > 0) counts.push(`${whatToBring.length} to bring`)
  if (exp.itineraryStepCount > 0) counts.push(`${exp.itineraryStepCount}-step itinerary`)

  const hasAnything =
    facets.length > 0 ||
    languages.length > 0 ||
    counts.length > 0 ||
    Boolean(exp.meetingPoint)

  if (!hasAnything) {
    return <span aria-label="No structured attributes">&mdash;</span>
  }

  return (
    <div className="space-y-1">
      {facets.length > 0 && <p className="capitalize">{facets.join(' · ')}</p>}
      {languages.length > 0 && <p>Languages: {languages.join(', ')}</p>}
      {exp.meetingPoint && <p className="truncate">Meets: {exp.meetingPoint}</p>}
      {counts.length > 0 && <p>{counts.join(' · ')}</p>}
    </div>
  )
}
