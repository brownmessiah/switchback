'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  payoutQueueCategoryLabel,
  type PayoutQueueCategory,
} from '@/lib/payments/payout-queue'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { CommissionSnapshot } from '../_components/commission-snapshot'
import { ConfirmMoneyDialog } from '../_components/confirm-money-dialog'
import { AdminLedgerLayout, LedgerDetailEmpty } from '../_components/admin-ledger-layout'
import { formatRupees } from '../_components/money'
import {
  approvePayoutAction,
  holdPayoutAction,
  rejectPayoutAction,
} from './actions'

export interface PayoutLedgerRow {
  bookingId: string
  state: string
  // The full payout_state enum (db/schema/bookings.ts). The admin approval
  // queue acts on the first four (pending/approved/rejected/held); the latter
  // four are the Payout Batch send lifecycle the Payout Batch cron drives
  // (ADR-0016, 2026-06-18 amendment) — surfaced read-only here.
  payoutState:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'held'
    | 'processing'
    | 'paid'
    | 'failed'
    | 'reversed'
  // The admin-queue category (lib/payments/payout-queue.ts). Distinguishes the
  // first-3 awaiting-approval queue (story 11) and the fund-account-blocked
  // exceptions (story 14) from auto-batching / maturing / sent Payouts, so
  // nothing silently disappears between approve and the 5pm-IST cron.
  category: PayoutQueueCategory
  manualPayoutsRemaining: number
  vendorName: string | null
  expTitle: string | null
  grossRupees: number
  commissionRupees: number
  commissionRatePercent: string
  gstOnCommissionRupees: number
  tdsRupees: number
  tcsRupees: number
  netPayoutRupees: number
}

type ActionKind = 'approve' | 'hold' | 'reject'

const PAYOUT_STATE_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  held: 'Held',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
  reversed: 'Reversed',
}

export function PayoutLedger({ rows }: { rows: PayoutLedgerRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.bookingId ?? null)
  const selected = rows.find((r) => r.bookingId === selectedId) ?? null

  return (
    <AdminLedgerLayout
      list={
        // overflow-x-auto on the Card lets the dense payout queue (with its
        // in-row Approve / Hold / Reject actions) scroll horizontally when the
        // split-view starves the left pane, instead of clipping the rightmost
        // Actions buttons at the card edge (B1). Mirrors the disputes ledger fix.
        <Card className="overflow-x-auto">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No payouts pending.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Experience</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Queue</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <PayoutRow
                      key={row.bookingId}
                      row={row}
                      selected={row.bookingId === selectedId}
                      onSelect={() => setSelectedId(row.bookingId)}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      }
      detail={
        selected ? (
          <PayoutDetail row={selected} />
        ) : (
          <LedgerDetailEmpty message="Select a payout to see its Commission Snapshot and actions." />
        )
      }
    />
  )
}

// ── A3 row: tabular money + status badge + in-row actions ──────────────

function PayoutRow({
  row,
  selected,
  onSelect,
}: {
  row: PayoutLedgerRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <TableRow
      data-booking-id={row.bookingId}
      data-testid={`payout-row-${row.bookingId}`}
      className={selected ? 'bg-muted/60' : undefined}
    >
      <TableCell className="font-medium">
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Select payout for ${row.vendorName ?? 'vendor'}`}
          className="text-left hover:underline focus-visible:underline"
        >
          {row.vendorName}
        </button>
      </TableCell>
      <TableCell className="text-sm">{row.expTitle}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {formatRupees(row.grossRupees)}
      </TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums">
        {formatRupees(row.netPayoutRupees)}
      </TableCell>
      <TableCell>
        <AdminStatusBadge status={row.payoutState} label={PAYOUT_STATE_LABEL[row.payoutState] ?? row.payoutState} />
      </TableCell>
      <TableCell>
        <PayoutQueueBadge category={row.category} />
      </TableCell>
      <TableCell>
        <PayoutActions row={row} onSelect={onSelect} />
      </TableCell>
    </TableRow>
  )
}

// ── Queue category badge ───────────────────────────────────────────────
//
// Surfaces the admin-queue category so the first-3 awaiting-approval queue
// (story 11) and the fund-account-blocked exceptions (story 14) are visible at
// a glance, distinct from auto-batching / maturing / sent Payouts. The label
// text carries the meaning (status never by color alone, DESIGN.md §1.3).

const QUEUE_CATEGORY_VARIANT: Record<
  PayoutQueueCategory,
  'warning' | 'info' | 'destructive' | 'success' | 'secondary' | 'outline'
> = {
  awaiting_approval: 'warning',
  blocked_fund_account: 'destructive',
  auto_pending: 'info',
  not_matured: 'outline',
  processing: 'info',
  paid: 'success',
  failed: 'destructive',
  reversed: 'secondary',
  held: 'secondary',
  rejected: 'secondary',
}

// Only the COMPUTED categories carry information the Status column does not
// already show. The PASSTHROUGH categories (processing/paid/failed/reversed/
// held/rejected) merely echo the payout-state badge with an identical label —
// rendering them duplicates the pill and makes `getByText('Held', {exact})`
// ambiguous. Suppress those; render an em-dash placeholder so the column stays
// aligned and the absence is explicit.
const COMPUTED_QUEUE_CATEGORIES: ReadonlySet<PayoutQueueCategory> = new Set([
  'awaiting_approval',
  'auto_pending',
  'blocked_fund_account',
  'not_matured',
])

function PayoutQueueBadge({ category }: { category: PayoutQueueCategory }) {
  if (!COMPUTED_QUEUE_CATEGORIES.has(category)) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <Badge variant={QUEUE_CATEGORY_VARIANT[category]} data-queue-category={category}>
      {payoutQueueCategoryLabel(category)}
    </Badge>
  )
}

// ── Detail pane: Commission Snapshot + action panel, CO-PRESENT ────────

function PayoutDetail({ row }: { row: PayoutLedgerRow }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium">{row.vendorName}</p>
          <p className="mb-3 text-xs text-muted-foreground">{row.expTitle}</p>
          <CommissionSnapshot
            grossRupees={row.grossRupees}
            commissionRupees={row.commissionRupees}
            commissionRatePercent={row.commissionRatePercent}
            gstOnCommissionRupees={row.gstOnCommissionRupees}
            tdsRupees={row.tdsRupees}
            tcsRupees={row.tcsRupees}
            netPayoutRupees={row.netPayoutRupees}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 text-sm font-semibold">Action</p>
          <PayoutActions row={row} variant="panel" />
        </CardContent>
      </Card>
    </div>
  )
}

// ── Shared action set: opens the A4 exact-figure confirm Dialog ────────

function PayoutActions({
  row,
  variant = 'row',
  onSelect,
}: {
  row: PayoutLedgerRow
  variant?: 'row' | 'panel'
  onSelect?: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [action, setAction] = useState<ActionKind | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const open = (kind: ActionKind) => {
    setReason('')
    setError(null)
    setAction(kind)
    onSelect?.()
  }

  const close = () => {
    setAction(null)
    setError(null)
    setReason('')
  }

  const confirm = () => {
    if ((action === 'hold' || action === 'reject') && !reason.trim()) return
    setError(null)
    startTransition(async () => {
      let result
      if (action === 'approve') result = await approvePayoutAction(row.bookingId)
      else if (action === 'hold') result = await holdPayoutAction(row.bookingId, reason)
      else if (action === 'reject') result = await rejectPayoutAction(row.bookingId, reason)
      else return
      if (result.ok) close()
      else setError(result.error)
    })
  }

  const showActions = row.payoutState === 'pending' || row.payoutState === 'held'

  return (
    <div className={variant === 'panel' ? 'space-y-3' : 'flex items-center gap-2'}>
      {variant === 'row' && row.manualPayoutsRemaining > 0 && (
        <Badge variant="secondary" className="text-xs">
          Manual: {row.manualPayoutsRemaining}
        </Badge>
      )}

      {showActions ? (
        <div className={variant === 'panel' ? 'flex flex-col gap-2' : 'flex items-center gap-2'}>
          <Button
            variant="default"
            size={variant === 'panel' ? 'default' : 'sm'}
            disabled={isPending}
            onClick={() => open('approve')}
            className={variant === 'panel' ? 'w-full' : undefined}
          >
            Approve
          </Button>
          {row.payoutState === 'pending' && (
            <Button
              variant="outline"
              size={variant === 'panel' ? 'default' : 'sm'}
              disabled={isPending}
              onClick={() => open('hold')}
              className={variant === 'panel' ? 'w-full' : undefined}
            >
              Hold
            </Button>
          )}
          <Button
            variant="outline"
            size={variant === 'panel' ? 'default' : 'sm'}
            disabled={isPending}
            onClick={() => open('reject')}
            className={
              variant === 'panel'
                ? 'w-full text-destructive hover:text-destructive'
                : 'text-destructive hover:text-destructive'
            }
          >
            Reject
          </Button>
        </div>
      ) : (
        // Terminal states show their badge in the Status column (row variant)
        // / a short note (panel variant) — no duplicate badge here.
        variant === 'panel' && (
          <p className="text-sm text-muted-foreground">
            This payout is {PAYOUT_STATE_LABEL[row.payoutState] ?? row.payoutState}. No action
            available.
          </p>
        )
      )}

      {error && variant === 'row' && (
        <span className="text-xs text-destructive">{error}</span>
      )}

      {/* A4 exact-figure confirm for APPROVE (restates the Net Vendor Payout) */}
      <ConfirmMoneyDialog
        open={action === 'approve'}
        onOpenChange={(o) => (o ? undefined : close())}
        title="Approve Payout"
        actionLabel="Approve Payout"
        amountRupees={row.netPayoutRupees}
        amountCaption="Net Vendor Payout to be disbursed"
        description="Confirm the exact net payout below. This releases real money to the Vendor and is recorded in the audit log."
        confirmDisabled={isPending}
        error={error}
        onConfirm={confirm}
      />

      {/* HOLD — exact gross figure + reason */}
      <Dialog open={action === 'hold'} onOpenChange={(o) => (o ? undefined : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hold Payout</DialogTitle>
            <DialogDescription>
              Provide a reason for holding this payout (e.g. dispute investigation). This freezes
              the payout timer. The Net Vendor Payout below stays unpaid until released.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[var(--radius-md)] border bg-muted/40 px-4 py-3 text-center">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatRupees(row.netPayoutRupees)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Net Vendor Payout held</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`hold-reason-${row.bookingId}`}>Hold reason</Label>
            <Textarea
              id={`hold-reason-${row.bookingId}`}
              placeholder="Hold reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={confirm}
              disabled={isPending || !reason.trim()}
            >
              Hold Payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT — exact gross figure + reason */}
      <Dialog open={action === 'reject'} onOpenChange={(o) => (o ? undefined : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payout</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this payout. This will be recorded in the audit log.
              The Net Vendor Payout below will NOT be disbursed.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[var(--radius-md)] border bg-muted/40 px-4 py-3 text-center">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatRupees(row.netPayoutRupees)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Net Vendor Payout rejected</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reject-reason-${row.bookingId}`}>Rejection reason</Label>
            <Textarea
              id={`reject-reason-${row.bookingId}`}
              placeholder="Rejection reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirm}
              disabled={isPending || !reason.trim()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
