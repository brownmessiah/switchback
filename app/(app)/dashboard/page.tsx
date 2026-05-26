import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { bookings, experiences, walletBalances } from '@/db/schema'
import { auth } from '@/lib/auth'

const STATE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  confirmed: 'default',
  awaiting_completion: 'secondary',
  completed: 'default',
  cancelled_by_customer: 'destructive',
  cancelled_by_vendor: 'destructive',
}

export default async function CustomerDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/en/sign-in')

  const userId = session.user.id

  const userBookings = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      gross: bookings.grossTotalSnapshot,
      paymentMode: bookings.paymentMode,
      expTitle: experiences.title,
      expSlug: experiences.slug,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(bookings.customerUserId, userId))
    .orderBy(bookings.createdAt)

  const walletRows = await db
    .select({
      balanceType: walletBalances.balanceType,
      amount: walletBalances.amount,
    })
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))

  const refundBalance = Math.floor(
    Number(walletRows.find((r) => r.balanceType === 'refund_balance')?.amount ?? 0),
  )
  const outversCredit = Math.floor(
    Number(walletRows.find((r) => r.balanceType === 'outvers_credit')?.amount ?? 0),
  )

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">My bookings</h1>

      {/* Wallet */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Refund balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              ₹{refundBalance.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cashable or usable on next booking
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outvers credit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              ₹{outversCredit.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Promotional credit — use on any booking
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator className="mb-8" />

      {/* Bookings list */}
      {userBookings.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-lg font-medium">No bookings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore experiences and book your first adventure.
          </p>
          <Link
            href="/en/search"
            className="mt-4 inline-block rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Explore
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {userBookings.map((b) => (
            <Link key={b.id} href={`/bookings/${b.id}/confirmation`} className="block">
              <Card className="transition hover:border-foreground/20 hover:shadow-sm">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{b.expTitle}</h3>
                      <Badge
                        variant={STATE_VARIANTS[b.state] ?? 'outline'}
                        className="shrink-0 capitalize text-xs"
                      >
                        {b.state.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {b.participantCount} guest{b.participantCount === 1 ? '' : 's'} ·
                      ₹{Math.floor(Number(b.gross ?? 0)).toLocaleString('en-IN')} ·{' '}
                      {new Date(b.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span className="ml-4 text-sm text-muted-foreground">→</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
