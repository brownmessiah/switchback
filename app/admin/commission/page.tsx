import { desc, eq } from 'drizzle-orm'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { users } from '@/db/schema/users'

import { CommissionLedger, type CommissionTierRow } from './commission-ledger'
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

function tierStatus(tier: { startAt: Date; endAt: Date }): { status: TierStatus; label: string } {
  const now = new Date()
  if (now < tier.startAt) return { status: 'upcoming', label: 'Upcoming' }
  if (now > tier.endAt) return { status: 'expired', label: 'Expired' }
  return { status: 'active', label: 'Active' }
}

// ── Page ───────────────────────────────────────────────────────────

export default async function CommissionPage() {
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

  const classified = tiers.map((t) => ({ ...t, ...tierStatus(t) }))

  const activeTiers = classified.filter((t) => t.status === 'active')
  const upcomingTiers = classified.filter((t) => t.status === 'upcoming')
  const expiredTiers = classified.filter((t) => t.status === 'expired')

  // Affected-Booking "blast radius" per tier (ADR-0008 + #34 scope-filtered).
  const bookingCounts: Record<string, number> = {}
  await Promise.all(
    classified.map(async (tier) => {
      bookingCounts[tier.id] = await getAffectedBookingCount(db, tier.id)
    }),
  )

  const ledgerTiers: CommissionTierRow[] = classified.map((t) => {
    const scopeParts: string[] = []
    if (t.appliesToCategories.length > 0)
      scopeParts.push(`Categories: ${t.appliesToCategories.join(', ')}`)
    if (t.appliesToVendorIds.length > 0) scopeParts.push(`${t.appliesToVendorIds.length} vendor(s)`)
    if (t.appliesToExperienceIds.length > 0)
      scopeParts.push(`${t.appliesToExperienceIds.length} experience(s)`)
    const scopeLabel = scopeParts.length > 0 ? scopeParts.join(' | ') : 'All'

    return {
      id: t.id,
      name: t.name,
      status: t.status,
      label: t.label,
      rateOverride: t.rateOverride,
      reason: t.reason,
      startAt: t.startAt.toISOString(),
      endAt: t.endAt.toISOString(),
      startAtLabel: formatDate(t.startAt),
      endAtLabel: formatDate(t.endAt),
      scopeLabel,
      affectedBookings: bookingCounts[t.id] ?? 0,
      adminLabel: t.adminEmail ?? t.adminName ?? '—',
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Commission Tiers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tiers.length} tier{tiers.length === 1 ? '' : 's'} &middot; {activeTiers.length} active
          &middot; {upcomingTiers.length} upcoming &middot; {expiredTiers.length} expired
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

      <CommissionLedger tiers={ledgerTiers} />
    </div>
  )
}
