'use client'

import { useState, useTransition } from 'react'

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

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { ConfirmMoneyDialog } from '../_components/confirm-money-dialog'
import { AdminLedgerLayout, LedgerDetailEmpty } from '../_components/admin-ledger-layout'
import { formatRupees } from '../_components/money'
import { approveRefundAction, rejectRefundAction } from './actions'

export interface RefundLedgerRow {
  id: string
  state: string
  amount: number
  reason: string
  destination: string
  bookingId: string
  customerEmail: string | null
  notes: string | null
  createdAtLabel: string
}

const REFUND_STATE_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  credited: 'Credited',
  failed: 'Failed',
  rejected: 'Rejected',
}

function destinationLabel(destination: string): string {
  // The Refund balance bucket is the cashable bucket (CONTEXT.md / ADR-0004).
  if (destination === 'refund_balance') return 'Refund balance'
  if (destination === 'switchback_credit') return 'Switchback credit'
  return destination.replace(/_/g, ' ')
}

export function RefundLedger({ rows }: { rows: RefundLedgerRow[] }) {
  const firstPending = rows.find((r) => r.state === 'pending')?.id ?? rows[0]?.id ?? null
  const [selectedId, setSelectedId] = useState<string | null>(firstPending)
  const selected = rows.find((r) => r.id === selectedId) ?? null

  return (
    <AdminLedgerLayout
      list={
        // overflow-x-auto on the Card lets the dense refund queue (with its
        // in-row Approve / Reject actions) scroll horizontally when the
        // split-view starves the left pane, instead of clipping the rightmost
        // Actions buttons at the card edge (B1). Mirrors the disputes ledger fix.
        <Card className="overflow-x-auto">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No refund requests.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <RefundRow
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
          <RefundDetail row={selected} />
        ) : (
          <LedgerDetailEmpty message="Select a refund request to see its breakdown and actions." />
        )
      }
    />
  )
}

function RefundRow({
  row,
  selected,
  onSelect,
}: {
  row: RefundLedgerRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <TableRow
      data-refund-request-id={row.id}
      data-testid={`refund-row-${row.id}`}
      className={selected ? 'bg-muted/60' : undefined}
    >
      <TableCell className="text-sm">
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Select refund request from ${row.customerEmail ?? 'customer'}`}
          className="text-left hover:underline focus-visible:underline"
        >
          {row.customerEmail}
        </button>
      </TableCell>
      <TableCell className="font-mono text-xs">{row.bookingId.slice(0, 8)}...</TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums">
        {formatRupees(row.amount)}
      </TableCell>
      <TableCell>
        <AdminStatusBadge status={row.state} label={REFUND_STATE_LABEL[row.state] ?? row.state} />
      </TableCell>
      <TableCell>
        <RefundActions row={row} onSelect={onSelect} />
      </TableCell>
    </TableRow>
  )
}

function RefundDetail({ row }: { row: RefundLedgerRow }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium">{row.customerEmail}</p>
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            Booking {row.bookingId.slice(0, 8)}...
          </p>

          <h3 className="mb-2 text-sm font-semibold">Refund breakdown</h3>
          <div className="divide-y">
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Requested amount</span>
              <span data-testid="refund-amount" className="tabular-nums">
                {formatRupees(row.amount)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Reason</span>
              <span className="capitalize">{row.reason.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Destination bucket</span>
              <span>{destinationLabel(row.destination)}</span>
            </div>
          </div>
          {row.notes && (
            <p className="mt-3 rounded-[var(--radius-md)] bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {row.notes}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 text-sm font-semibold">Action</p>
          <RefundActions row={row} variant="panel" />
        </CardContent>
      </Card>
    </div>
  )
}

function RefundActions({
  row,
  variant = 'row',
  onSelect,
}: {
  row: RefundLedgerRow
  variant?: 'row' | 'panel'
  onSelect?: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [approveAmount, setApproveAmount] = useState(row.amount.toString())
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const numericApprove = parseInt(approveAmount, 10)
  const restated = Number.isNaN(numericApprove) ? 0 : numericApprove

  function openApprove() {
    setApproveAmount(row.amount.toString())
    setError(null)
    setApproveOpen(true)
    onSelect?.()
  }

  function openReject() {
    setRejectReason('')
    setError(null)
    setRejectOpen(true)
    onSelect?.()
  }

  function handleApprove() {
    const numAmount = parseInt(approveAmount, 10)
    if (Number.isNaN(numAmount) || numAmount <= 0) {
      setError('Amount must be a positive integer.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await approveRefundAction(row.id, numAmount)
      if (result.ok) setApproveOpen(false)
      else setError(result.error)
    })
  }

  function handleReject() {
    if (!rejectReason.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await rejectRefundAction(row.id, rejectReason)
      if (result.ok) {
        setRejectOpen(false)
        setRejectReason('')
      } else {
        setError(result.error)
      }
    })
  }

  if (row.state !== 'pending') {
    // Terminal states show their badge in the Status column (row variant) — no
    // duplicate badge in the actions cell.
    if (variant === 'row') return null
    return (
      <p className="text-sm text-muted-foreground">
        This refund is {REFUND_STATE_LABEL[row.state] ?? row.state}. No action available.
      </p>
    )
  }

  return (
    <div className={variant === 'panel' ? 'flex flex-col gap-2' : 'flex items-center gap-2'}>
      <Button
        variant="default"
        size={variant === 'panel' ? 'default' : 'sm'}
        disabled={isPending}
        onClick={openApprove}
        className={variant === 'panel' ? 'w-full' : undefined}
      >
        Approve
      </Button>
      <Button
        variant="outline"
        size={variant === 'panel' ? 'default' : 'sm'}
        disabled={isPending}
        onClick={openReject}
        className={
          variant === 'panel'
            ? 'w-full text-destructive hover:text-destructive'
            : 'text-destructive hover:text-destructive'
        }
      >
        Reject
      </Button>

      {error && variant === 'row' && <span className="text-xs text-destructive">{error}</span>}

      {/* A4 exact-figure confirm for APPROVE — editable amount preserved, the
          restated figure tracks the editable amount before confirm. */}
      <ConfirmMoneyDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve Refund"
        actionLabel="Approve Refund"
        amountRupees={restated}
        amountCaption="Credited immediately to the Customer's Refund balance"
        description="Confirm the exact refund amount. The Customer's Refund balance will be credited immediately. You may approve a partial amount."
        confirmDisabled={isPending}
        error={error}
        onConfirm={handleApprove}
      >
        <div className="space-y-2">
          <Label htmlFor={`approve-amount-${row.id}`}>Refund amount (₹)</Label>
          <Input
            id={`approve-amount-${row.id}`}
            type="number"
            min={1}
            max={row.amount}
            value={approveAmount}
            onChange={(e) => setApproveAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Requested amount: {formatRupees(row.amount)}
          </p>
        </div>
      </ConfirmMoneyDialog>

      {/* REJECT — reason + the exact amount NOT credited */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Refund</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this refund request. This will be recorded in the
              audit log and shown to the Customer. The amount below will NOT be credited.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[var(--radius-md)] border bg-muted/40 px-4 py-3 text-center">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatRupees(row.amount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Refund declined — not credited</p>
          </div>
          <Textarea
            placeholder="Rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || !rejectReason.trim()}
            >
              Reject Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
