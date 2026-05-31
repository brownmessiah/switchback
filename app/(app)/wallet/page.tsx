import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Clock,
  Info,
  ShieldCheck,
  Wallet as WalletIcon,
} from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

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
import { auth } from '@/lib/auth'
import { loadWalletView } from '@/lib/payments/wallet-view'

const PAGE_SIZE = 15

// The ledger's source enum (ADR-0004) → a stable WalletPage i18n key. Keeps
// the user-facing label translatable rather than echoing the raw enum.
const SOURCE_LABEL_KEY: Record<string, string> = {
  promo: 'sourcePromo',
  referral: 'sourceReferral',
  refund: 'sourceRefund',
  admin: 'sourceAdmin',
  checkout_deduction: 'sourceCheckoutDeduction',
  expiry: 'sourceExpiry',
}

// The two ADR-0004 buckets carry a semantic color FAMILY paired with a label
// (never color alone — DESIGN.md §1.3 / WCAG 1.4.1).
const BUCKET_BADGE: Record<string, { variant: 'success' | 'info'; key: string }> = {
  refund_balance: { variant: 'success', key: 'refundBalance' },
  outvers_credit: { variant: 'info', key: 'outversCredit' },
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

interface WalletPageProps {
  searchParams: Promise<{ page?: string }>
}

export default async function WalletPage({ searchParams }: WalletPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const userId = session.user.id
  const t = await getTranslations('WalletPage')

  const { page: pageParam } = await searchParams
  const requestedPage = Number.parseInt(pageParam ?? '1', 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1

  const view = await loadWalletView(db, userId, { page, pageSize: PAGE_SIZE })

  const hasPrev = view.page > 1
  const hasNext = view.page < view.totalPages

  return (
    <main
      data-testid="wallet-page"
      className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('backToDashboard')}
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* ── Two SEPARATE buckets (ADR-0004) ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Outvers credit — closed-loop promo, never cashable, EXPIRES. */}
        <Card data-testid="wallet-bucket-outvers_credit" className="border-credit/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <WalletIcon className="size-4 text-credit" aria-hidden />
              {t('outversCredit')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              data-testid="wallet-amount-outvers_credit"
              className="text-3xl font-semibold tabular-nums"
            >
              {formatRupees(view.balances.outversCredit)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t('outversCreditHint')}</p>
            {view.balances.outversCredit > 0 && view.soonestCreditExpiry ? (
              <span
                data-testid="wallet-credit-expiry"
                className="mt-3 inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning"
              >
                <Clock className="size-3" aria-hidden />
                {t('creditExpiry', { date: formatDate(view.soonestCreditExpiry) })}
              </span>
            ) : null}
          </CardContent>
        </Card>

        {/* Refund balance — cashable to original method (text-only CTA). */}
        <Card data-testid="wallet-bucket-refund_balance" className="border-success/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              {t('refundBalance')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              data-testid="wallet-amount-refund_balance"
              className="text-3xl font-semibold tabular-nums"
            >
              {formatRupees(view.balances.refundBalance)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t('refundBalanceHint')}</p>
            {/* Cash-out is an HONEST disabled affordance — the flow is out of
                scope (ADR-0004). Text-only, not a dead button. */}
            <div
              data-testid="wallet-cashout"
              className="mt-3 flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-foreground">{t('cashOut')}</span>
                {' — '}
                {t('cashOutInfo')}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Transaction ledger (newest-first, paginated) ── */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">{t('ledgerTitle')}</h2>

        {view.transactions.length === 0 ? (
          <div
            data-testid="wallet-ledger-empty"
            className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground"
          >
            {t('ledgerEmpty')}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table data-testid="wallet-ledger">
                <caption className="sr-only">{t('ledgerTitle')}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('colDate')}</TableHead>
                    <TableHead scope="col">{t('colBucket')}</TableHead>
                    <TableHead scope="col">{t('colSource')}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t('colAmount')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.transactions.map((txn) => {
                    const isCredit = txn.amount >= 0
                    const bucket = BUCKET_BADGE[txn.balanceType]
                    const sourceKey = SOURCE_LABEL_KEY[txn.source]
                    // Sign is conveyed by +/− TEXT and an icon, not color alone
                    // (DESIGN.md §1.3 / WCAG 1.4.1).
                    const SignIcon = isCredit ? ArrowUpRight : ArrowDownLeft
                    return (
                      <TableRow key={txn.id} data-testid="wallet-ledger-row">
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(txn.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={bucket ? bucket.variant : 'outline'}
                            className="text-xs"
                          >
                            {bucket
                              ? t(bucket.key)
                              : txn.balanceType.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {sourceKey ? t(sourceKey) : txn.source.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell
                          className={`text-right text-sm font-medium tabular-nums ${
                            isCredit ? 'text-success' : 'text-destructive'
                          }`}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            <SignIcon className="size-3.5" aria-hidden />
                            <span className="sr-only">
                              {isCredit ? t('credit') : t('debit')}{' '}
                            </span>
                            {isCredit ? '+' : '−'}
                            {formatRupees(Math.abs(txn.amount))}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Pager — Link-based so it works without client JS. */}
        {view.totalPages > 1 ? (
          <nav
            data-testid="wallet-pager"
            aria-label={t('ledgerTitle')}
            className="mt-4 flex items-center justify-between"
          >
            {hasPrev ? (
              <Link
                href={`/wallet?page=${view.page - 1}`}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <ArrowLeft className="size-4" aria-hidden />
                {t('previous')}
              </Link>
            ) : (
              <span
                aria-disabled
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-50"
              >
                <ArrowLeft className="size-4" aria-hidden />
                {t('previous')}
              </span>
            )}

            <span className="text-sm text-muted-foreground tabular-nums">
              {t('page', { page: view.page, totalPages: view.totalPages })}
            </span>

            {hasNext ? (
              <Link
                href={`/wallet?page=${view.page + 1}`}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                {t('next')}
                <ArrowUpRight className="size-4 rotate-45" aria-hidden />
              </Link>
            ) : (
              <span
                aria-disabled
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-50"
              >
                {t('next')}
                <ArrowUpRight className="size-4 rotate-45" aria-hidden />
              </span>
            )}
          </nav>
        ) : null}
      </section>
    </main>
  )
}
