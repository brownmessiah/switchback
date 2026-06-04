import {
  AlertTriangle,
  ArrowRight,
  BadgeIndianRupee,
  Banknote,
  Clock,
  Coins,
  FileCheck2,
  Landmark,
  LifeBuoy,
  ScrollText,
  TrendingUp,
  Undo2,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { cn } from '@/lib/utils'

import { loadAdminDashboard } from './loaders'

/** Status family used for KPI accent + the action-rail urgency badge. */
type StatusTone = 'danger' | 'warning' | 'info' | 'credit' | 'success'

const TONE_ICON_CLASS: Record<StatusTone, string> = {
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning-subtle text-warning',
  info: 'bg-info-subtle text-info',
  credit: 'bg-credit-subtle text-credit',
  success: 'bg-success-subtle text-success',
}

const BADGE_VARIANT: Record<StatusTone, 'destructive' | 'warning' | 'info' | 'credit' | 'success'> =
  {
    danger: 'destructive',
    warning: 'warning',
    info: 'info',
    credit: 'credit',
    success: 'success',
  }

function inr(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN')}`
}

export default async function AdminDashboardPage() {
  const { stats, pending, money, recentActivity } = await loadAdminDashboard(db)

  const totalPending =
    pending.pendingKyc +
    pending.pendingExperiences +
    pending.disputedBookings +
    pending.pendingRefunds +
    pending.openTickets +
    pending.pendingPayouts

  // ── Money KPI cards (DESIGN.md §6 #57-A hero band) ────────────────
  // Each is a live link into the queue the figure is computed from, money in
  // .tabular-nums, status color + icon for urgency (status never by color
  // alone — DESIGN.md §1.3 / §5).
  const kpis: readonly MoneyKpiCardProps[] = [
    {
      testId: 'kpi-pending-payouts',
      label: 'Pending payouts',
      amount: money.pendingPayouts,
      href: '/admin/payouts',
      icon: Banknote,
      tone: money.pendingPayouts > 0 ? 'warning' : 'success',
      sub: 'Net owed to Vendors',
    },
    {
      testId: 'kpi-refund-liability',
      label: 'Refund liability',
      amount: money.refundLiability,
      href: '/admin/refunds',
      icon: Undo2,
      tone: money.refundLiability > 0 ? 'danger' : 'success',
      sub: 'Pending refunds owed to Customers',
    },
    {
      testId: 'kpi-commission',
      label: 'Commission',
      amount: money.commission,
      href: '/admin/commission',
      icon: Coins,
      tone: 'info',
      sub: 'Platform commission on pending payouts',
    },
    {
      testId: 'kpi-gst-tds-due',
      label: 'GST / TDS due',
      amount: money.gstTdsDue,
      href: '/admin/payouts',
      icon: Landmark,
      tone: money.gstTdsDue > 0 ? 'credit' : 'success',
      sub: 'GST on Commission + TDS §194-O + TCS §52',
    },
    {
      testId: 'kpi-net-revenue',
      label: 'Net revenue',
      amount: money.netRevenue,
      href: '/admin/commission',
      icon: TrendingUp,
      tone: 'success',
      sub: 'Commission retained, net of GST remitted on it',
    },
  ]

  // ── "Needs action now" rail (absorbs variant B) ──────────────────
  // Cross-queue work items, SLA-ranked by money/risk severity (highest first),
  // then de-prioritising the empty ones to the bottom while preserving order.
  const actionItems: readonly ActionItem[] = [
    {
      label: 'Disputed bookings',
      count: pending.disputedBookings,
      href: '/admin/disputes',
      icon: AlertTriangle,
      tone: 'danger',
      testId: 'pending-disputed',
      sla: 'Money at risk · resolve first',
    },
    {
      label: 'Pending refunds',
      count: pending.pendingRefunds,
      href: '/admin/refunds',
      icon: Wallet,
      tone: 'danger',
      sla: 'Customer owed · 24–48h SLA',
    },
    {
      label: 'Pending payouts',
      count: pending.pendingPayouts,
      href: '/admin/payouts',
      icon: BadgeIndianRupee,
      tone: 'warning',
      sla: 'Vendor owed · T+7 window',
    },
    {
      label: 'KYC verifications',
      count: pending.pendingKyc,
      href: '/admin/vendors',
      icon: FileCheck2,
      tone: 'warning',
      sla: 'Blocks Vendor go-live',
    },
    {
      label: 'Open support tickets',
      count: pending.openTickets,
      href: '/admin/support',
      icon: LifeBuoy,
      tone: 'info',
      sla: 'Respond within SLA',
    },
    {
      label: 'Experience reviews',
      count: pending.pendingExperiences,
      href: '/admin/experiences',
      icon: ScrollText,
      tone: 'info',
      sla: 'Awaiting publish review',
    },
  ]
  // SLA ordering: surface non-empty queues first (keep severity order within
  // each group), so the operator works the live queues top-down.
  const rankedActions = [...actionItems].sort((a, b) => {
    const aActive = a.count > 0 ? 0 : 1
    const bActive = b.count > 0 ? 0 : 1
    return aActive - bActive
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Admin overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Money command center — act on what the platform owes and is owed.
        </p>
      </div>

      {/* ── Money KPI band (hero) ─────────────────────────────────── */}
      <section aria-label="Money correctness">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {kpis.map((kpi) => (
            <MoneyKpiCard key={kpi.testId} {...kpi} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Needs action now rail ──────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              Needs action now
              {totalPending > 0 ? (
                <Badge variant="destructive" className="text-xs tabular-nums">
                  {totalPending}
                </Badge>
              ) : (
                <Badge variant="success" className="text-xs">
                  All clear
                </Badge>
              )}
            </CardTitle>
            {/* Preserved label — the dashboard-load E2E asserts this text. */}
            <p className="text-xs text-muted-foreground">Pending actions, SLA-ranked.</p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {rankedActions.map((item) => (
                <ActionRow key={item.label} {...item} />
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ── Platform totals (preserved count tiles) ────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Platform totals</CardTitle>
            <p className="text-xs text-muted-foreground">Lifetime counts.</p>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              <CountTile label="Users" value={stats.userCount} testId="stat-users" />
              <CountTile label="Vendors" value={stats.vendorCount} testId="stat-vendors" />
              <CountTile
                label="Experiences"
                value={stats.experienceCount}
                testId="stat-experiences"
              />
              <CountTile label="Bookings" value={stats.bookingCount} testId="stat-bookings" />
              <div className="col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Total revenue</dt>
                <dd
                  className="mt-0.5 text-2xl font-semibold tabular-nums"
                  data-testid="stat-revenue"
                >
                  {inr(stats.totalRevenue)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* ── Recent activity (kept) ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.sublabel}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">
                      {item.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Components ──────────────────────────────────────────────────────

interface MoneyKpiCardProps {
  readonly testId: string
  readonly label: string
  readonly amount: number
  readonly href: string
  readonly icon: LucideIcon
  readonly tone: StatusTone
  readonly sub: string
}

function MoneyKpiCard({ testId, label, amount, href, icon: Icon, tone, sub }: MoneyKpiCardProps) {
  return (
    <a
      href={href}
      data-testid={testId}
      className="group rounded-[var(--radius-card)] outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-[box-shadow,transform] group-hover:-translate-y-0.5 group-hover:shadow-md motion-reduce:transform-none">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-[var(--radius-control)]',
                TONE_ICON_CLASS[tone],
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums" data-testid={`${testId}-amount`}>
            {inr(amount)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {sub}
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </p>
        </CardContent>
      </Card>
    </a>
  )
}

interface ActionItem {
  readonly label: string
  readonly count: number
  readonly href: string
  readonly icon: LucideIcon
  readonly tone: StatusTone
  readonly sla: string
  readonly testId?: string
}

function ActionRow({ label, count, href, icon: Icon, tone, sla, testId }: ActionItem) {
  const isActive = count > 0
  return (
    <li>
      <a
        href={href}
        className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
            isActive ? TONE_ICON_CLASS[tone] : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{sla}</p>
        </div>
        <Badge
          variant={isActive ? BADGE_VARIANT[tone] : 'secondary'}
          className="shrink-0 gap-1 tabular-nums"
          data-testid={testId}
        >
          {isActive ? <Clock className="size-3" aria-hidden="true" /> : null}
          {count}
        </Badge>
      </a>
    </li>
  )
}

interface CountTileProps {
  readonly label: string
  readonly value: number
  readonly testId: string
}

function CountTile({ label, value, testId }: CountTileProps) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value.toLocaleString('en-IN')}
      </dd>
    </div>
  )
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
