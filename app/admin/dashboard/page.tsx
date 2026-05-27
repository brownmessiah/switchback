import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'

import { loadAdminDashboard } from './loaders'

export default async function AdminDashboardPage() {
  const { stats, pending, recentActivity } = await loadAdminDashboard(db)

  const totalPending =
    pending.pendingKyc +
    pending.pendingExperiences +
    pending.disputedBookings +
    pending.pendingRefunds +
    pending.openTickets +
    pending.pendingPayouts

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Admin overview</h1>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.userCount.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Vendors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.vendorCount.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Experiences</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.experienceCount.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.bookingCount.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">₹{stats.totalRevenue.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            Pending actions
            {totalPending > 0 && (
              <Badge variant="destructive" className="text-xs">
                {totalPending}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <PendingItem label="KYC verifications" count={pending.pendingKyc} href="/admin/vendors" />
            <PendingItem label="Experience reviews" count={pending.pendingExperiences} href="/admin/experiences" />
            <PendingItem label="Disputed bookings" count={pending.disputedBookings} href="/admin/disputes" />
            <PendingItem label="Pending refunds" count={pending.pendingRefunds} href="/admin/refunds" />
            <PendingItem label="Open support tickets" count={pending.openTickets} href="/admin/support" />
            <PendingItem label="Pending payouts" count={pending.pendingPayouts} href="/admin/payouts" />
          </div>
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No recent activity.
            </p>
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

// ── Helpers ───────────────────────────────────────────────────────

function PendingItem({
  label,
  count,
  href,
}: {
  readonly label: string
  readonly count: number
  readonly href: string
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
    >
      <span className="text-sm font-medium">{label}</span>
      <Badge variant={count > 0 ? 'destructive' : 'secondary'} className="text-xs">
        {count}
      </Badge>
    </a>
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
