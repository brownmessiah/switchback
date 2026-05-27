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
import { db } from '@/db/client'
import { promoCodes } from '@/db/schema/promo-codes'
import { users } from '@/db/schema/users'

import { PromoActionsCell } from './promo-actions-cell'
import { PromoCreateForm } from './promo-form'

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function promoStatus(promo: {
  active: boolean
  startsAt: Date | null
  expiresAt: Date | null
}): { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' } {
  if (!promo.active) return { label: 'Inactive', variant: 'secondary' }
  const now = new Date()
  if (promo.startsAt && now < promo.startsAt) return { label: 'Scheduled', variant: 'outline' }
  if (promo.expiresAt && now > promo.expiresAt) return { label: 'Expired', variant: 'destructive' }
  return { label: 'Active', variant: 'default' }
}

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Promo Codes</h1>
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Credit</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Per User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No promo codes yet. Create one above.
                  </TableCell>
                </TableRow>
              )}
              {promos.map((p) => {
                const status = promoStatus(p)
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium text-sm">
                      {p.code}
                    </TableCell>
                    <TableCell className="text-sm">
                      INR {Math.floor(Number(p.creditAmount))}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.currentUses}
                      {p.maxTotalUses ? ` / ${p.maxTotalUses}` : ''}
                    </TableCell>
                    <TableCell className="text-sm">{p.perUserLimit}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className="text-xs">
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.startsAt)} — {formatDate(p.expiresAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.adminEmail ?? p.adminName ?? '—'}
                    </TableCell>
                    <TableCell>
                      <PromoActionsCell
                        id={p.id}
                        active={p.active}
                        currentUses={p.currentUses}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
