import { desc, eq } from 'drizzle-orm'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { promoCodes } from '@/db/schema/promo-codes'
import { users } from '@/db/schema/users'

import { PromoCreateForm } from './promo-form'
import { PromoTable, type PromoTableRow } from './promo-table'

export default async function PromoCodesPage() {
  const promos = await db
    .select({
      id: promoCodes.id,
      code: promoCodes.code,
      creditAmount: promoCodes.creditAmount,
      maxTotalUses: promoCodes.maxTotalUses,
      currentUses: promoCodes.currentUses,
      perUserLimit: promoCodes.perUserLimit,
      active: promoCodes.active,
      startsAt: promoCodes.startsAt,
      expiresAt: promoCodes.expiresAt,
      createdByAdminId: promoCodes.createdByAdminId,
      createdAt: promoCodes.createdAt,
      adminName: users.name,
      adminEmail: users.email,
    })
    .from(promoCodes)
    .leftJoin(users, eq(promoCodes.createdByAdminId, users.id))
    .orderBy(desc(promoCodes.createdAt))

  const totalActive = promos.filter((p) => p.active).length
  const totalRedemptions = promos.reduce((sum, p) => sum + p.currentUses, 0)

  const rows: PromoTableRow[] = promos.map((p) => ({
    id: p.id,
    code: p.code,
    creditAmount: p.creditAmount,
    maxTotalUses: p.maxTotalUses,
    currentUses: p.currentUses,
    perUserLimit: p.perUserLimit,
    active: p.active,
    startsAt: p.startsAt,
    expiresAt: p.expiresAt,
    adminName: p.adminName,
    adminEmail: p.adminEmail,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Promo Codes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {promos.length} promo code{promos.length === 1 ? '' : 's'} &middot;{' '}
          {totalActive} active &middot; {totalRedemptions} total redemptions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create New Promo Code</CardTitle>
        </CardHeader>
        <CardContent>
          <PromoCreateForm />
        </CardContent>
      </Card>

      <PromoTable rows={rows} />
    </div>
  )
}
