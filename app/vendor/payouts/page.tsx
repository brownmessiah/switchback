import { and, eq, inArray, sql } from 'drizzle-orm'
import { headers } from 'next/headers'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { bookings, experiences, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

export default async function VendorPayoutsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const [vendor] = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)

  const completedBookings = await db
    .select({
      bookingId: bookings.id,
      gross: bookings.grossTotalSnapshot,
      commissionRate: bookings.commissionRateSnapshot,
      tdsAmount: bookings.tdsAmountSnapshot,
      gstRate: bookings.gstRateOnCommissionSnapshot,
      state: bookings.state,
      expTitle: experiences.title,
      completedAt: bookings.completedAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, userId),
        inArray(bookings.state, ['completed', 'awaiting_completion']),
      ),
    )
    .orderBy(bookings.completedAt)

  const totalGross = completedBookings.reduce(
    (sum, b) => sum + Math.floor(Number(b.gross ?? 0)),
    0,
  )
  const totalCommission = completedBookings.reduce((sum, b) => {
    const gross = Number(b.gross ?? 0)
    const rate = Number(b.commissionRate ?? 20) / 100
    return sum + Math.floor(gross * rate)
  }, 0)
  const totalTds = completedBookings.reduce(
    (sum, b) => sum + Math.floor(Number(b.tdsAmount ?? 0)),
    0,
  )
  const netPayout = totalGross - totalCommission - totalTds

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earnings summary and payout breakdown.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gross earnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              ₹{totalGross.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Commission
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-muted-foreground">
              -₹{totalCommission.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              TDS (1%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-muted-foreground">
              -₹{totalTds.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net payout
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-primary">
              ₹{netPayout.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payout method */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payout method</CardTitle>
        </CardHeader>
        <CardContent>
          {vendor?.payoutMethod ? (
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="uppercase">
                {vendor.payoutMethod}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {vendor.payoutMethod === 'upi'
                  ? (vendor.payoutDestination as { vpa?: string })?.vpa ?? 'VPA configured'
                  : 'Bank account configured'}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No payout method configured. Complete onboarding to set up payouts.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payout schedule info */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-2 text-sm font-semibold">How payouts work</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Payouts are processed T+7 days after experience completion.</li>
            <li>Outvers deducts platform commission ({vendor?.commissionRate ?? '20'}%) + 18% GST on commission.</li>
            <li>1% TDS (Section 194-O) is withheld for resident Indian vendors.</li>
            <li>The first 3 payouts after KYC Tier 2 require manual admin approval.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
