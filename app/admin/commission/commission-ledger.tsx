'use client'

import { useRef, useState, useTransition } from 'react'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { AdminLedgerLayout, LedgerDetailEmpty } from '../_components/admin-ledger-layout'
import {
  deleteCommissionTier,
  updateCommissionTier,
  type CommissionTierActionResult,
} from './actions'

export interface CommissionTierRow {
  id: string
  name: string
  status: 'active' | 'upcoming' | 'expired'
  label: string
  rateOverride: string
  reason: string
  startAt: string
  endAt: string
  startAtLabel: string
  endAtLabel: string
  scopeLabel: string
  affectedBookings: number
  adminLabel: string
}

export function CommissionLedger({ tiers }: { tiers: CommissionTierRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(tiers[0]?.id ?? null)
  const selected = tiers.find((t) => t.id === selectedId) ?? null

  const active = tiers.filter((t) => t.status === 'active')
  const upcoming = tiers.filter((t) => t.status === 'upcoming')
  const expired = tiers.filter((t) => t.status === 'expired')

  return (
    <AdminLedgerLayout
      list={
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="expired">Expired ({expired.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            <TierTable tiers={active} selectedId={selectedId} onSelect={setSelectedId} emptyMessage="No active commission tiers." />
          </TabsContent>
          <TabsContent value="upcoming">
            <TierTable tiers={upcoming} selectedId={selectedId} onSelect={setSelectedId} emptyMessage="No upcoming commission tiers." />
          </TabsContent>
          <TabsContent value="expired">
            <TierTable tiers={expired} selectedId={selectedId} onSelect={setSelectedId} emptyMessage="No expired commission tiers." />
          </TabsContent>
        </Tabs>
      }
      detail={
        selected ? (
          <TierDetail tier={selected} />
        ) : (
          <LedgerDetailEmpty message="Select a commission tier to see its rate, scope and actions." />
        )
      }
    />
  )
}

function TierTable({
  tiers,
  selectedId,
  onSelect,
  emptyMessage,
}: {
  tiers: CommissionTierRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  emptyMessage: string
}) {
  return (
    // overflow-x-auto on the Card lets the dense tier list scroll horizontally
    // when the split-view left pane is narrow, instead of clipping the rightmost
    // Status column at the card edge (B1). The tier Edit/Delete actions live in
    // the detail pane, so this only affects the read-only list scroll.
    <Card className="overflow-x-auto">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Bookings</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              tiers.map((tier) => (
                <TableRow
                  key={tier.id}
                  data-tier-id={tier.id}
                  data-testid={`tier-row-${tier.id}`}
                  className={tier.id === selectedId ? 'bg-muted/60' : undefined}
                >
                  <TableCell className="font-mono text-sm font-medium">
                    <button
                      type="button"
                      onClick={() => onSelect(tier.id)}
                      aria-label={`Select commission tier ${tier.name}`}
                      className="text-left hover:underline focus-visible:underline"
                    >
                      {tier.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {Number(tier.rateOverride).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tier.startAtLabel} &mdash; {tier.endAtLabel}
                  </TableCell>
                  <TableCell
                    className="text-right text-sm tabular-nums"
                    data-affected-count={tier.affectedBookings}
                  >
                    {tier.affectedBookings}
                  </TableCell>
                  <TableCell>
                    <AdminStatusBadge status={tier.status} label={tier.label} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function TierDetail({ tier }: { tier: CommissionTierRow }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <p className="font-mono text-sm font-medium">{tier.name}</p>
          <div className="mt-1 mb-3">
            <AdminStatusBadge status={tier.status} label={tier.label} />
          </div>

          <h3 className="mb-2 text-sm font-semibold">Tier details</h3>
          <div className="divide-y">
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Commission rate</span>
              <span data-testid="tier-rate" className="font-medium tabular-nums">
                {Number(tier.rateOverride).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Affected Bookings</span>
              <span data-testid="tier-affected" className="tabular-nums">
                {tier.affectedBookings}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Window</span>
              <span className="text-right">
                {tier.startAtLabel} — {tier.endAtLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">Scope</span>
              <span className="text-right">{tier.scopeLabel}</span>
            </div>
          </div>
          <p className="mt-3 rounded-[var(--radius-md)] bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {tier.reason}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 text-sm font-semibold">Action</p>
          <TierActions tier={tier} />
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * The Edit / Delete actions for a commission tier. These live ONLY in the
 * split-view detail rail (the redundant in-row copies were removed to fix the
 * B1 table-clipping — the Bookings column was starved off the card edge by the
 * extra Actions column). The rate change is gated behind an exact-rate confirm.
 */
function TierActions({ tier }: { tier: CommissionTierRow }) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingForm, setPendingForm] = useState<FormData | null>(null)
  const [pendingRate, setPendingRate] = useState<string>(tier.rateOverride)
  const [editResult, setEditResult] = useState<CommissionTierActionResult | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function toLocalDatetime(iso: string): string {
    const date = new Date(iso)
    const offset = date.getTimezoneOffset()
    const local = new Date(date.getTime() - offset * 60_000)
    return local.toISOString().slice(0, 16)
  }

  // Step 1: collecting the form → open the exact-rate confirm before committing.
  function handleEditSubmit(formData: FormData) {
    formData.set('id', tier.id)
    setPendingForm(formData)
    setPendingRate(String(formData.get('rateOverride') ?? tier.rateOverride))
    setEditOpen(false)
    setConfirmOpen(true)
  }

  // Step 2: the operator confirms the exact new rate → commit the update.
  function handleConfirm() {
    if (!pendingForm) return
    startTransition(async () => {
      const res = await updateCommissionTier(pendingForm)
      setEditResult(res)
      if (res.ok) {
        setConfirmOpen(false)
        setPendingForm(null)
      }
    })
  }

  function handleDelete() {
    if (!confirm(`Delete commission tier "${tier.name}"?`)) return
    startTransition(async () => {
      await deleteCommissionTier(tier.id)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() => setEditOpen(true)}
          className="w-full"
        >
          Edit
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Commission Tier</DialogTitle>
            <DialogDescription>
              Update the tier details. Name must be a lowercase slug. You will confirm the exact
              new rate before it is applied.
            </DialogDescription>
          </DialogHeader>
          <form ref={formRef} action={handleEditSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-name-${tier.id}`}>Name</Label>
              <Input
                id={`edit-name-${tier.id}`}
                name="name"
                defaultValue={tier.name}
                pattern="^[a-z0-9_-]+$"
                title="Lowercase letters, numbers, hyphens, underscores only"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-rate-${tier.id}`}>Rate (%)</Label>
              <Input
                id={`edit-rate-${tier.id}`}
                name="rateOverride"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={Number(tier.rateOverride)}
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`edit-start-${tier.id}`}>Start Date</Label>
                <Input
                  id={`edit-start-${tier.id}`}
                  name="startAt"
                  type="datetime-local"
                  defaultValue={toLocalDatetime(tier.startAt)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`edit-end-${tier.id}`}>End Date</Label>
                <Input
                  id={`edit-end-${tier.id}`}
                  name="endAt"
                  type="datetime-local"
                  defaultValue={toLocalDatetime(tier.endAt)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-reason-${tier.id}`}>Reason</Label>
              <Textarea
                id={`edit-reason-${tier.id}`}
                name="reason"
                defaultValue={tier.reason}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        disabled={isPending}
        onClick={handleDelete}
        className="w-full text-destructive hover:text-destructive"
      >
        Delete
      </Button>

      {editResult && !editResult.ok && (
        <p className="text-sm text-destructive" role="alert">
          {editResult.error}
        </p>
      )}

      {/* Exact-rate confirm — restates the new commission rate + blast radius
          before the update is committed (a misclick must not re-price). */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm commission rate change</DialogTitle>
            <DialogDescription>
              Confirm the exact new rate below. Existing Bookings keep their locked Commission
              Snapshot (ADR-0008); this changes the tier going forward.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[var(--radius-md)] border bg-muted/40 px-4 py-3 text-center">
            <p
              data-testid="tier-rate-confirm"
              className="text-2xl font-semibold tabular-nums tracking-tight"
            >
              {Number(pendingRate).toFixed(2)}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              New commission rate for tier &ldquo;{tier.name}&rdquo;
            </p>
          </div>
          {editResult && !editResult.ok && (
            <p className="text-sm text-destructive" role="alert">
              {editResult.error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="button" variant="default" onClick={handleConfirm} disabled={isPending}>
              Confirm rate change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
