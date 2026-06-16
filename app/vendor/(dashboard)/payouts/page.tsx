import { and, eq, inArray } from 'drizzle-orm'
import { CheckCircle2, Clock } from 'lucide-react'
import { headers } from 'next/headers'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { db } from '@/db/client'
import { availabilitySlots, bookings, experiences, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { requireVendorAccess } from '@/lib/auth/permissions'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'
import {
  groupBookingsIntoPayoutCycles,
  type PayoutCycleBooking,
} from '@/lib/payments/payout-cycles'

import { VendorTableTabs } from '../vendor-table-tabs'

const inr = (n: number) => `₹${Math.floor(n).toLocaleString('en-IN')}`

/**
 * Per-cycle constituent-Booking columns for the Earnings Ledger A3 table. Drives
 * the `<ResponsiveTable>` so each cycle's full ADR-0016 deduction trail (Gross →
 * Commission → GST → TDS → TCS → Net) renders as a table at `≥ md` and as a
 * stacked label:value Card list below `md` (DESIGN.md §8.5) — the 7-column tax
 * trail never forces a 360px h-scroll. Every per-row E2E hook (`cycle-gross`,
 * `cycle-commission`, …) flows through the column `cell()` + the table's
 * `rowProps`, so the vendor payouts spec selectors survive the reversal.
 */
const PAYOUT_CYCLE_COLUMNS: ReadonlyArray<
  ResponsiveTableColumn<PayoutCycleBooking>
> = [
  {
    key: 'experience',
    header: 'Experience',
    primary: true,
    cell: (row) => row.experienceTitle,
  },
  {
    key: 'gross',
    header: 'Gross',
    align: 'right',
    cell: (row) => <span data-testid="cycle-gross">{inr(row.grossRupees)}</span>,
  },
  {
    key: 'commission',
    header: 'Commission',
    align: 'right',
    cell: (row) => (
      <span data-testid="cycle-commission" className="text-muted-foreground">
        -{inr(row.commissionRupees)}
      </span>
    ),
  },
  {
    key: 'gst',
    header: 'GST (18%)',
    align: 'right',
    cell: (row) => (
      <span data-testid="cycle-gst" className="text-muted-foreground">
        -{inr(row.gstOnCommissionRupees)}
      </span>
    ),
  },
  {
    key: 'tds',
    header: 'TDS',
    align: 'right',
    cell: (row) => (
      <span data-testid="cycle-tds" className="text-muted-foreground">
        -{inr(row.tdsRupees)}
      </span>
    ),
  },
  {
    key: 'tcs',
    header: 'TCS',
    align: 'right',
    cell: (row) => (
      <span data-testid="cycle-tcs" className="text-muted-foreground">
        -{inr(row.tcsRupees)}
      </span>
    ),
  },
  {
    key: 'net',
    header: 'Net',
    align: 'right',
    cell: (row) => (
      <span data-testid="cycle-net" className="font-medium">
        {inr(row.netPayoutRupees)}
      </span>
    ),
  },
]

export default async function VendorPayoutsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  // Permission gate (issue #03 review, FIX 1) — the layout only enforces
  // `bookings:read` (held by every Vendor role), so payouts-read denial (Guide
  // and Booking Staff have no `payouts:read`) must be enforced HERE at the
  // route. Throwing variant → `notFound()`, matching the layout's gate call.
  await requireVendorAccess(db, userId, 'payouts:read')

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
      payoutState: bookings.payoutState,
      expTitle: experiences.title,
      requiredPermits: experiences.requiredPermits,
      completedAt: bookings.completedAt,
      slotStart: availabilitySlots.startAt,
      slotEnd: availabilitySlots.endAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
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

  // The Earnings Ledger spine: group the Vendor's earning Bookings into payout
  // cycles derived from REAL data — completion timestamp + the ADR-0016 window
  // (T+7 default, T+30 for permit-required / multi-day). Each cycle expands to
  // its constituent Bookings with the full deduction trail. NO fabrication: a
  // Booking with no completion (awaiting_completion) has no release date and is
  // not yet a cycle member.
  const cycles = groupBookingsIntoPayoutCycles(
    completedBookings.map((b) => {
      const slotStart = b.slotStart ? new Date(b.slotStart) : null
      const slotEnd = b.slotEnd ? new Date(b.slotEnd) : null
      const multiDay =
        slotStart != null &&
        slotEnd != null &&
        slotStart.toISOString().slice(0, 10) !== slotEnd.toISOString().slice(0, 10)
      return {
        bookingId: b.bookingId,
        experienceTitle: b.expTitle,
        customerName: null,
        completedAt: b.completedAt ? new Date(b.completedAt) : null,
        payoutState: b.payoutState,
        grossRupees: Math.floor(Number(b.gross ?? 0)),
        commissionRatePercent: String(b.commissionRate ?? '20.00'),
        gstRateOnCommissionPercent: String(b.gstRate ?? '18.00'),
        tdsRupees: Math.floor(Number(b.tdsAmount ?? 0)),
        tcsRupees: Math.floor(Number(b.tcsAmount ?? 0)),
        permitRequired: (b.requiredPermits ?? []).length > 0,
        multiDay,
      }
    }),
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earnings ledger — reconcile each payout cycle to its bookings.
        </p>
      </div>

      <VendorTableTabs active="payouts" />

      {/* Headline cards — gross in, net out. Money cards stack on phone, 2-col
          at md (DESIGN.md §8.3 Wallet/money-cards row; never flip off sm:). */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gross earnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {inr(totalGross)}
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
            <p className="text-2xl font-semibold text-primary tabular-nums">
              {inr(netPayout)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Earnings Ledger — payout is the spine. Each cycle (T+7 from completion,
          T+30 for permit-required / multi-day per ADR-0016) is an accordion;
          expanding it reveals its constituent Bookings with the full
          Gross → Commission → GST → TDS → TCS → Net trail per row.
          `data-testid="earnings-ledger"` lives on a plain section wrapper (NOT a
          Card — each cycle's `<ResponsiveTable>` owns its own Card>CardContent
          p-0 shell ≥ md, so a page-level Card here would nest card-in-card per
          cycle, the bug §8.5 guards against). */}
      <section data-testid="earnings-ledger" className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Earnings ledger</h2>
        {cycles.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No payout cycles yet. A cycle opens once a booking is completed —
              payouts release T+7 days after completion.
            </CardContent>
          </Card>
        ) : (
          <Accordion multiple className="w-full">
            {cycles.map((cycle) => {
              const key = cycle.releaseDate.toISOString().slice(0, 10)
              const releaseLabel = cycle.releaseDate.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
              const StatusIcon = cycle.status === 'paid' ? CheckCircle2 : Clock
              return (
                <AccordionItem
                  key={key}
                  value={key}
                  data-testid="payout-cycle"
                  className="border-b last:border-b-0"
                >
                  <AccordionTrigger
                    data-testid="payout-cycle-trigger"
                    className="items-center"
                  >
                    <span className="flex flex-1 flex-wrap items-center gap-3">
                      <span className="font-medium">Payout · {releaseLabel}</span>
                      <Badge
                        variant={cycle.status === 'paid' ? 'success' : 'warning'}
                        className="text-xs capitalize"
                      >
                        <StatusIcon aria-hidden="true" />
                        {cycle.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {cycle.bookings.length} booking
                        {cycle.bookings.length === 1 ? '' : 's'}
                      </span>
                      <span className="ml-auto pr-3 font-medium tabular-nums">
                        {inr(cycle.totals.netPayoutRupees)}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pt-1">
                      {/* A3 constituent-Booking trail — table ≥ md, stacked
                          label:value Cards < md (DESIGN.md §8.5). */}
                      <ResponsiveTable<PayoutCycleBooking>
                        caption={`Bookings in the payout cycle releasing ${releaseLabel}`}
                        columns={PAYOUT_CYCLE_COLUMNS}
                        rows={cycle.bookings}
                        getRowKey={(row) => row.bookingId}
                        rowProps={(row) => ({
                          'data-testid': 'payout-cycle-booking',
                          'data-booking-id': row.bookingId,
                        })}
                      />
                      {/* Cycle totals (replaces the as-is TableFooter, which the
                          ResponsiveTable has no slot for) — a label:value strip
                          that reflows on phone and aligns under the columns at
                          md+ via a matching 7-col grid. */}
                      <div className="rounded-[var(--radius-card)] border border-border bg-muted/30 px-4 py-3 text-sm md:grid md:grid-cols-7 md:items-center md:gap-3 md:px-3">
                        <p className="mb-1 font-medium md:mb-0">Total</p>
                        <TotalCell label="Gross" value={inr(cycle.totals.grossRupees)} />
                        <TotalCell
                          label="Commission"
                          value={`-${inr(cycle.totals.commissionRupees)}`}
                        />
                        <TotalCell
                          label="GST (18%)"
                          value={`-${inr(cycle.totals.gstOnCommissionRupees)}`}
                        />
                        <TotalCell
                          label="TDS"
                          value={`-${inr(cycle.totals.tdsRupees)}`}
                        />
                        <TotalCell
                          label="TCS"
                          value={`-${inr(cycle.totals.tcsRupees)}`}
                        />
                        <TotalCell
                          label="Net"
                          value={inr(cycle.totals.netPayoutRupees)}
                          emphasis
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
      </section>

      {/* Payout breakdown — the full ADR-0016 deduction waterfall across ALL
          earning Bookings. gross − Commission − GST(18%) − TDS(0.1%) − TCS(0.5%) = net */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payout breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border text-sm">
            <div className="flex items-center justify-between py-2">
              <dt>Gross earnings</dt>
              <dd className="font-medium tabular-nums">{inr(totalGross)}</dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>Commission</dt>
              <dd className="tabular-nums">-{inr(totalCommission)}</dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>GST on commission (18%)</dt>
              <dd className="tabular-nums">-{inr(totalGstOnCommission)}</dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>TDS (0.1%, Sec 194-O)</dt>
              <dd className="tabular-nums">-{inr(totalTds)}</dd>
            </div>
            <div className="flex items-center justify-between py-2 text-muted-foreground">
              <dt>GST TCS (0.5%, Sec 52)</dt>
              <dd className="tabular-nums">-{inr(totalTcs)}</dd>
            </div>
            <div className="flex items-center justify-between py-2 text-base font-semibold">
              <dt>Net payout</dt>
              <dd className="text-primary tabular-nums">{inr(netPayout)}</dd>
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

/**
 * One cycle-totals figure. On phone it reads as a `label: value` row; at `md`+
 * it becomes a right-aligned grid cell that lines up under the matching A3
 * numeric column (the totals strip is a 7-col grid mirroring the table). The
 * label is `sr-only` at `md`+ because the column header already names it.
 */
function TotalCell({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 md:block md:text-right">
      <span className="text-muted-foreground md:sr-only">{label}</span>
      <span
        className={`tabular-nums ${emphasis ? 'font-semibold' : 'font-medium'}`}
      >
        {value}
      </span>
    </div>
  )
}
