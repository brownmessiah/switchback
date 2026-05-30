import { and, eq, inArray } from 'drizzle-orm'
import { headers } from 'next/headers'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { bookings, experiences, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

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
      tcsAmount: bookings.tcsAmountSnapshot,
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

  // Per-Booking net Payout per ADR-0016, summed across the Vendor's earning
  // Bookings. computeVendorNetPayout re-derives Commission + GST-on-commission
  // from the snapshotted RATES and consumes the pre-floored TDS / TCS rupee
  // AMOUNTS, so the displayed breakdown matches the M3 disbursement exactly:
  //   net = gross − Commission − GST(18% on Commission) − TDS(0.1%) − TCS(0.5%)
  const totals = completedBookings.reduce(
    (acc, b) => {
      const breakdown = computeVendorNetPayout({
        grossRupees: Math.floor(Number(b.gross ?? 0)),
        commissionRatePercent: String(b.commissionRate ?? '20.00'),
        gstRateOnCommissionPercent: String(b.gstRate ?? '18.00'),
        tdsRupees: Math.floor(Number(b.tdsAmount ?? 0)),
        tcsRupees: Math.floor(Number(b.tcsAmount ?? 0)),
      })
      return {
        gross: acc.gross + breakdown.grossRupees,
        commission: acc.commission + breakdown.commissionRupees,
        gstOnCommission: acc.gstOnCommission + breakdown.gstOnCommissionRupees,
        tds: acc.tds + breakdown.tdsRupees,
        tcs: acc.tcs + breakdown.tcsRupees,
        net: acc.net + breakdown.netPayoutRupees,
      }
    },
    { gross: 0, commission: 0, gstOnCommission: 0, tds: 0, tcs: 0, net: 0 },
  )

  const totalGross = totals.gross
  const totalCommission = totals.commission
  const totalGstOnCommission = totals.gstOnCommission
  const totalTds = totals.tds
  const totalTcs = totals.tcs
  const netPayout = totals.net

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earnings summary and payout breakdown.
        </p>
      </div>

      {/* Headline cards — gross in, net out */}
      <div className="grid gap-4 sm:grid-cols-2">
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

      {/* Payout breakdown — the full ADR-0016 deduction waterfall.
          gross − Commission − GST(18% on commission) − TDS(0.1%) − TCS(0.5%) = net */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payout breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border text-sm">
            <div className="flex items-center justify-between py-2">
              <dt>Gross earnings</dt>
              <dd className="font-medium tabular-nums">
                ₹{totalGross.toLocaleString('en-IN')}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>Commission</dt>
              <dd className="tabular-nums">
                -₹{totalCommission.toLocaleString('en-IN')}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>GST on commission (18%)</dt>
              <dd className="tabular-nums">
                -₹{totalGstOnCommission.toLocaleString('en-IN')}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>TDS (0.1%, Sec 194-O)</dt>
              <dd className="tabular-nums">
                -₹{totalTds.toLocaleString('en-IN')}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>GST TCS (0.5%, Sec 52)</dt>
              <dd className="tabular-nums">
                -₹{totalTcs.toLocaleString('en-IN')}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2 text-base font-semibold">
              <dt>Net payout</dt>
              <dd className="text-primary tabular-nums">
                ₹{netPayout.toLocaleString('en-IN')}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

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
            <li>0.1% TDS (Section 194-O, Finance Act 2024) is withheld for resident Indian vendors.</li>
            <li>0.5% GST TCS (Section 52) is collected and remitted monthly via GSTR-8.</li>
            <li>The first 3 payouts after KYC Tier 2 require manual admin approval.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
