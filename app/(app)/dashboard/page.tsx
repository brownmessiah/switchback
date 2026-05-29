import { and, asc, eq, gt, isNotNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { bookings, experiences, walletBalances, walletTransactions } from '@/db/schema'
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
  if (!session?.user) redirect('/sign-in')

  const userId = session.user.id
  const t = await getTranslations('CustomerNav')

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

  // Outvers credit expires 12–18mo from issue (ADR-0004). The aggregate
  // wallet_balances row has no expiry of its own — expiry lives on the
  // immutable ledger. Surface the SOONEST upcoming expiry for the credit
  // bucket so the Customer knows their closed-loop credit is time-bound.
  const [nextCreditExpiry] = await db
    .select({ expiresAt: walletTransactions.expiresAt })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.balanceType, 'outvers_credit'),
        isNotNull(walletTransactions.expiresAt),
        gt(walletTransactions.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(walletTransactions.expiresAt))
    .limit(1)

  const creditExpiresAt =
    outversCredit > 0 ? (nextCreditExpiry?.expiresAt ?? null) : null

  return (
    <main
      data-testid="customer-dashboard"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>

      {/* Wallet — two SEPARATE buckets (ADR-0004) */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        {/* Refund balance — cashable to original payment method */}
        <Card data-testid="wallet-bucket-refund_balance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('wallet.refundBalance')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="wallet-amount" className="text-2xl font-semibold">
              ₹{refundBalance.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('wallet.refundHint')}
            </p>
            {/* Cashable-to-original-method option (ADR-0004). The cashout flow
                itself is deferred (M3 / #72); the OPTION must be surfaced. */}
            <p
              data-testid="wallet-cashout-option"
              className="mt-2 text-xs text-muted-foreground"
            >
              {t('wallet.cashoutOption')}
            </p>
          </CardContent>
        </Card>
        {/* Outvers credit — closed-loop, never cashable, EXPIRES */}
        <Card data-testid="wallet-bucket-outvers_credit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('wallet.outversCredit')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="wallet-amount" className="text-2xl font-semibold">
              ₹{outversCredit.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('wallet.creditHint')}
            </p>
            {/* Expiry (12–18mo from issue, ADR-0004) — closed-loop credit is
                time-bound, so the soonest upcoming expiry is surfaced. */}
            {creditExpiresAt ? (
              <p
                data-testid="wallet-credit-expiry"
                className="mt-2 text-xs text-muted-foreground"
              >
                {t('wallet.creditExpiry', {
                  date: new Date(creditExpiresAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Separator className="mb-8" />

      {/* Bookings list */}
      {userBookings.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-lg font-medium">{t('bookings.empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bookings.emptyHint')}
          </p>
          <Link
            href="/en/search"
            className="mt-4 inline-block rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('bookings.explore')}
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
                        data-testid="booking-status"
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
