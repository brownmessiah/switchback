'use client'

import { useState, useTransition } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

import { AdminLedgerLayout, LedgerDetailEmpty } from '../_components/admin-ledger-layout'
import { AdminStatusBadge } from '../_components/admin-status-badge'
import { ConfirmMoneyDialog } from '../_components/confirm-money-dialog'
import { formatRupees } from '../_components/money'
import { DisputeActionsCell } from './dispute-actions-cell'
import { resolveAsCompletedAction, resolveAsCancelledAction } from './actions'

/**
 * #93 — admin Dispute queue as a DESIGN.md §4 split-view ledger (variant B):
 *
 *  - LEFT: an A3 dispute queue (one row per disputed Booking, gross in
 *    `.tabular-nums`, payout state as a semantic `AdminStatusBadge`). Each row
 *    keeps the existing in-row `DisputeActionsCell` (UNCHANGED) so the load-
 *    bearing E2E #25 resolution flow — `Complete` / `Cancel & Refund` →
 *    `Resolve as Completed` / `Cancel & Full Refund` — is preserved verbatim.
 *  - RIGHT: a persistent detail pane showing the selected dispute's Booking
 *    context (Customer / Vendor / Experience / slot) + the MONEY IMPACT of each
 *    resolution, with the resolve actions co-present behind an A4
 *    `ConfirmMoneyDialog` that restates the exact refund ₹ before commit:
 *      · Resolve as Completion → partial refund ₹ + commission adjust, payout
 *        held → pending.
 *      · Resolve as cancelled_post_experience → FULL refund ₹, no commission,
 *        payout held → rejected.
 *
 * Both panel actions call the SAME Server Actions as the in-row cell — money
 * writes and audit are unchanged (actions.ts / admin-dispute-actions.ts).
 * Token-true + English-only.
 */
export interface DisputeLedgerRow {
  id: string
  state: string
  participantCount: number
  grossRupees: number
  commissionRatePercent: string
  paymentMode: string
  payoutState: string
  confirmedAt: Date | null
  customerName: string | null
  customerEmail: string | null
  experienceTitle: string
  vendorBusinessName: string
  slotStart: Date | null
}

const PAYOUT_STATE_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  held: 'Held',
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function DisputeLedger({ rows }: { rows: DisputeLedgerRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null)
  const selected = rows.find((r) => r.id === selectedId) ?? null

  return (
    <AdminLedgerLayout
      list={
        // overflow-x-auto on the Card lets the dense queue (with its load-bearing
        // in-row Complete / Cancel & Refund actions — E2E #25) scroll horizontally
        // when the split-view starves the left pane, instead of clipping the
        // rightmost Actions button at the card edge (B1). The Card's own
        // overflow-hidden still rounds the corners on the y-axis.
        <Card className="overflow-x-auto">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No disputed bookings. All clear.
              </div>
            ) : (
              <Table>
                <caption className="sr-only">Dispute queue</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Customer</TableHead>
                    <TableHead scope="col">Experience</TableHead>
                    <TableHead scope="col" className="text-right">
                      Gross
                    </TableHead>
                    <TableHead scope="col">Payout</TableHead>
                    <TableHead scope="col">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <DisputeRow
                      key={row.id}
                      row={row}
                      selected={row.id === selectedId}
                      onSelect={() => setSelectedId(row.id)}
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
          <DisputeDetail row={selected} />
        ) : (
          <LedgerDetailEmpty message="Select a disputed Booking to see its context and the money impact of each resolution." />
        )
      }
    />
  )
}

// ── A3 row: tabular gross + payout badge + the UNCHANGED in-row actions ──

function DisputeRow({
  row,
  selected,
  onSelect,
}: {
  row: DisputeLedgerRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <TableRow
      data-booking-id={row.id}
      data-testid={`dispute-row-${row.id}`}
      className={selected ? 'bg-muted/60' : undefined}
    >
      <TableCell className="text-sm">
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Select dispute from ${row.customerName ?? row.customerEmail ?? 'customer'}`}
          className="text-left hover:underline focus-visible:underline"
        >
          <span className="font-medium">{row.customerName ?? row.customerEmail}</span>
        </button>
      </TableCell>
      <TableCell className="max-w-[180px] truncate text-sm">{row.experienceTitle}</TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums">
        {formatRupees(row.grossRupees)}
      </TableCell>
      <TableCell>
        <AdminStatusBadge
          status={row.payoutState}
          label={PAYOUT_STATE_LABEL[row.payoutState] ?? row.payoutState}
        />
      </TableCell>
      <TableCell>
        <DisputeActionsCell
          bookingId={row.id}
          grossTotal={row.grossRupees}
          commissionRate={row.commissionRatePercent}
        />
      </TableCell>
    </TableRow>
  )
}

// ── Detail pane: Booking context + money impact + resolve panel, CO-PRESENT ──

function DisputeDetail({ row }: { row: DisputeLedgerRow }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium">{row.experienceTitle}</p>
          <p className="text-xs text-muted-foreground">{row.vendorBusinessName}</p>

          <h3 className="mb-2 mt-3 text-sm font-semibold">Booking context</h3>
          <div className="divide-y">
            <DetailRow label="Customer" value={row.customerName ?? row.customerEmail ?? '—'} />
            <DetailRow label="Participants" value={String(row.participantCount)} />
            <DetailRow label="Slot" value={formatDate(row.slotStart)} />
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Gross Total</span>
              <span data-testid="dispute-gross" className="tabular-nums font-medium">
                {formatRupees(row.grossRupees)}
              </span>
            </div>
            <DetailRow label="Commission rate" value={`${row.commissionRatePercent}%`} />
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Payout</span>
              <AdminStatusBadge
                status={row.payoutState}
                label={PAYOUT_STATE_LABEL[row.payoutState] ?? row.payoutState}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 text-sm font-semibold">Resolve dispute</p>
          <DisputeResolvePanel row={row} />
        </CardContent>
      </Card>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}

// ── Resolve panel: each action behind an A4 exact-figure ConfirmMoneyDialog ──

function DisputeResolvePanel({ row }: { row: DisputeLedgerRow }) {
  const [isPending, startTransition] = useTransition()
  const [action, setAction] = useState<'complete' | 'cancel' | null>(null)
  const [notes, setNotes] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [adjustedRate, setAdjustedRate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const numericRefund = refundAmount ? parseInt(refundAmount, 10) : 0
  const restated = action === 'cancel' ? row.grossRupees : Number.isNaN(numericRefund) ? 0 : numericRefund

  function open(kind: 'complete' | 'cancel') {
    setNotes('')
    setRefundAmount('')
    setAdjustedRate('')
    setError(null)
    setAction(kind)
  }

  function close() {
    setAction(null)
    setError(null)
  }

  function confirm() {
    if (!notes.trim()) {
      setError('Admin notes are required.')
      return
    }
    if (action === 'complete') {
      const partialRefund = refundAmount ? parseInt(refundAmount, 10) : undefined
      if (refundAmount && (Number.isNaN(partialRefund!) || partialRefund! < 0)) {
        setError('Refund amount must be a non-negative integer.')
        return
      }
      const commissionAdj = adjustedRate.trim() || undefined
      if (commissionAdj && !/^\d{1,3}\.\d{2}$/.test(commissionAdj)) {
        setError('Commission rate must be in format XX.XX (e.g. 10.00)')
        return
      }
      setError(null)
      startTransition(async () => {
        const result = await resolveAsCompletedAction(
          row.id,
          notes,
          partialRefund,
          commissionAdj,
        )
        if (result.ok) close()
        else setError(result.error)
      })
    } else if (action === 'cancel') {
      setError(null)
      startTransition(async () => {
        const result = await resolveAsCancelledAction(row.id, notes)
        if (result.ok) close()
        else setError(result.error)
      })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => open('complete')}
        disabled={isPending}
        className="inline-flex h-9 w-full items-center justify-center rounded-[var(--radius-control)] bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        Resolve as Completion
      </button>
      <button
        type="button"
        onClick={() => open('cancel')}
        disabled={isPending}
        className="inline-flex h-9 w-full items-center justify-center rounded-[var(--radius-control)] border border-input px-3 text-sm font-medium text-destructive transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
      >
        Resolve as cancelled (full refund)
      </button>

      {/* A4 confirm — Completion: partial refund ₹ restated + notes + adjust */}
      <ConfirmMoneyDialog
        open={action === 'complete'}
        onOpenChange={(o) => (o ? undefined : close())}
        title="Resolve as Completion"
        actionLabel="Confirm resolution"
        amountRupees={restated}
        amountCaption="Partial refund credited to the Customer's Refund balance — payout resumes (held → pending)"
        description="Mark this disputed Booking completed (Vendor's favour). The payout countdown resumes. Optionally credit a partial goodwill refund and record an adjusted commission rate for payout reconciliation."
        confirmDisabled={isPending}
        error={error}
        onConfirm={confirm}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`panel-complete-notes-${row.id}`}>Admin notes (required)</Label>
            <Textarea
              id={`panel-complete-notes-${row.id}`}
              placeholder="Explain the resolution..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`panel-partial-refund-${row.id}`}>
              Partial refund amount (optional, ₹)
            </Label>
            <Input
              id={`panel-partial-refund-${row.id}`}
              type="number"
              min={0}
              max={row.grossRupees}
              placeholder="0"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Gross total: {formatRupees(row.grossRupees)}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`panel-adjusted-rate-${row.id}`}>
              Adjusted commission rate (optional, e.g. 10.00)
            </Label>
            <Input
              id={`panel-adjusted-rate-${row.id}`}
              placeholder={row.commissionRatePercent}
              value={adjustedRate}
              onChange={(e) => setAdjustedRate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Current rate: {row.commissionRatePercent}%. Recorded in the audit log for payout
              reconciliation.
            </p>
          </div>
        </div>
      </ConfirmMoneyDialog>

      {/* A4 confirm — Cancel post-experience: FULL gross restated + notes */}
      <ConfirmMoneyDialog
        open={action === 'cancel'}
        onOpenChange={(o) => (o ? undefined : close())}
        title="Resolve as cancelled (post-experience)"
        actionLabel="Confirm resolution"
        amountRupees={row.grossRupees}
        amountCaption="Full refund credited to the Customer's Refund balance — no Vendor payout (held → rejected)"
        description="Cancel this Booking post-experience (Customer wins). The full gross is credited to the Customer's Refund balance, no commission is taken, and no Vendor payout is disbursed."
        confirmVariant="destructive"
        confirmDisabled={isPending}
        error={error}
        onConfirm={confirm}
      >
        <div className="space-y-2">
          <Label htmlFor={`panel-cancel-notes-${row.id}`}>Admin notes (required)</Label>
          <Textarea
            id={`panel-cancel-notes-${row.id}`}
            placeholder="Explain the resolution..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
      </ConfirmMoneyDialog>
    </div>
  )
}
