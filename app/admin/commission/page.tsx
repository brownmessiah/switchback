import { desc, eq } from 'drizzle-orm'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { db } from '@/db/client'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { users } from '@/db/schema/users'

import { CommissionTierActionsCell } from './commission-tier-actions-cell'
import { CommissionTierCreateForm } from './commission-tier-form'
import { getAffectedBookingCount } from './actions'

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type TierStatus = 'active' | 'upcoming' | 'expired'

function tierStatus(tier: {
  startAt: Date
  endAt: Date
}): { status: TierStatus; label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' } {
  const now = new Date()
  if (now < tier.startAt) return { status: 'upcoming', label: 'Upcoming', variant: 'outline' }
  if (now > tier.endAt) return { status: 'expired', label: 'Expired', variant: 'destructive' }
  return { status: 'active', label: 'Active', variant: 'default' }
}

// ── Page ───────────────────────────────────────────────────────────

export default async function CommissionPage() {
  // Fetch all commission tiers with creator info
  const tiers = await db
    .select({
      id: commissionTiers.id,
      name: commissionTiers.name,
      startAt: commissionTiers.startAt,
      endAt: commissionTiers.endAt,
      rateOverride: commissionTiers.rateOverride,
      reason: commissionTiers.reason,
      appliesToCategories: commissionTiers.appliesToCategories,
      appliesToVendorIds: commissionTiers.appliesToVendorIds,
      appliesToExperienceIds: commissionTiers.appliesToExperienceIds,
      createdByAdminUserId: commissionTiers.createdByAdminUserId,
      createdAt: commissionTiers.createdAt,
      adminEmail: users.email,
      adminName: users.name,
    })
    .from(commissionTiers)
    .leftJoin(users, eq(commissionTiers.createdByAdminUserId, users.id))
    .orderBy(desc(commissionTiers.startAt))

  // Classify tiers
  const classified = tiers.map((t) => ({
    ...t,
    ...tierStatus(t),
  }))

  const activeTiers = classified.filter((t) => t.status === 'active')
  const upcomingTiers = classified.filter((t) => t.status === 'upcoming')
  const expiredTiers = classified.filter((t) => t.status === 'expired')

  // Affected-Booking "blast radius" preview per tier. Per ADR-0008 + the #34
  // scope-filter fix this is the SCOPE-filtered count (honours
  // appliesToCategories / VendorIds / ExperienceIds), not a window-only count —
  // so an admin sees exactly how many existing Bookings a tier change touches.
  // Computed for every tier (active / upcoming / expired), since the preview is
  // meaningful regardless of the tier's live-window status.
  const bookingCounts: Record<string, number> = {}
  await Promise.all(
    classified.map(async (tier) => {
      bookingCounts[tier.id] = await getAffectedBookingCount(db, tier.id)
    }),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Commission Tiers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tiers.length} tier{tiers.length === 1 ? '' : 's'} &middot;{' '}
          {activeTiers.length} active &middot;{' '}
          {upcomingTiers.length} upcoming &middot;{' '}
          {expiredTiers.length} expired
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create Festival Tier</CardTitle>
        </CardHeader>
        <CardContent>
          <CommissionTierCreateForm />
        </CardContent>
      </Card>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Active ({activeTiers.length})
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            Upcoming ({upcomingTiers.length})
          </TabsTrigger>
          <TabsTrigger value="expired">
            Expired ({expiredTiers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <TierTable
            tiers={activeTiers}
            emptyMessage="No active commission tiers."
            showBookingCount
            bookingCounts={bookingCounts}
          />
        </TabsContent>

        <TabsContent value="upcoming">
          <TierTable
            tiers={upcomingTiers}
            emptyMessage="No upcoming commission tiers."
            showBookingCount
            bookingCounts={bookingCounts}
          />
        </TabsContent>

        <TabsContent value="expired">
          <TierTable
            tiers={expiredTiers}
            emptyMessage="No expired commission tiers."
            showBookingCount
            bookingCounts={bookingCounts}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Shared table component ────────────────────────────────────────

interface TierRow {
  id: string
  name: string
  startAt: Date
  endAt: Date
  rateOverride: string
  reason: string
  appliesToCategories: string[]
  appliesToVendorIds: string[]
  appliesToExperienceIds: string[]
  createdByAdminUserId: string
  createdAt: Date
  adminEmail: string | null
  adminName: string | null
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
}

function TierTable({
  tiers,
  emptyMessage,
  showBookingCount = false,
  bookingCounts = {},
}: {
  tiers: TierRow[]
  emptyMessage: string
  showBookingCount?: boolean
  bookingCounts?: Record<string, number>
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              {showBookingCount && <TableHead>Bookings</TableHead>}
              <TableHead>Reason</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={showBookingCount ? 9 : 8}
                  className="py-8 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {tiers.map((t) => {
              const scopeParts: string[] = []
              if (t.appliesToCategories.length > 0)
                scopeParts.push(`Categories: ${t.appliesToCategories.join(', ')}`)
              if (t.appliesToVendorIds.length > 0)
                scopeParts.push(`${t.appliesToVendorIds.length} vendor(s)`)
              if (t.appliesToExperienceIds.length > 0)
                scopeParts.push(`${t.appliesToExperienceIds.length} experience(s)`)
              const scopeLabel = scopeParts.length > 0 ? scopeParts.join(' | ') : 'All'

              return (
                <TableRow key={t.id} data-tier-id={t.id}>
                  <TableCell className="text-sm font-mono font-medium">
                    {t.name}
                  </TableCell>
                  <TableCell className="text-sm">
                    {Number(t.rateOverride).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(t.startAt)} &mdash; {formatDate(t.endAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {scopeLabel}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.variant} className="text-xs">
                      {t.label}
                    </Badge>
                  </TableCell>
                  {showBookingCount && (
                    <TableCell className="text-sm" data-affected-count={bookingCounts[t.id] ?? 0}>
                      {bookingCounts[t.id] ?? 0}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {t.reason}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.adminEmail ?? t.adminName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <CommissionTierActionsCell
                      id={t.id}
                      name={t.name}
                      rateOverride={t.rateOverride}
                      reason={t.reason}
                      startAt={t.startAt}
                      endAt={t.endAt}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
