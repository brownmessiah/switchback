'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { deletePromoCode, togglePromoCode } from './actions'

interface PromoActionsCellProps {
  id: string
  active: boolean
  currentUses: number
}

/** Which consequential promo confirm is open (null = none). */
type ConfirmKind = 'deactivate' | 'delete' | null

/**
 * #95 — per-row promo actions. Deactivating stops a LIVE promo (no more
 * redemptions) and deleting permanently removes it (ADR-0004), so each is gated
 * behind a confirm Dialog that restates the consequence before the action fires
 * (DESIGN.md §4 A4 — consequential decisions confirm). Re-activating an inactive
 * promo is not destructive, so it fires inline. The Server Actions
 * (togglePromoCode / deletePromoCode) are called UNCHANGED with the same inputs.
 */
export function PromoActionsCell({ id, active, currentUses }: PromoActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [error, setError] = useState<string | null>(null)

  function handleActivate() {
    setError(null)
    startTransition(async () => {
      const result = await togglePromoCode(id, true)
      if (!result.ok) setError(result.error)
    })
  }

  function handleDeactivate() {
    setError(null)
    startTransition(async () => {
      const result = await togglePromoCode(id, false)
      if (result.ok) {
        setConfirm(null)
      } else {
        setError(result.error)
        setConfirm(null)
      }
    })
  }

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deletePromoCode(id)
      if (result.ok) {
        setConfirm(null)
      } else {
        setError(result.error)
        setConfirm(null)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      {active ? (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null)
            setConfirm('deactivate')
          }}
        >
          Deactivate
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={isPending} onClick={handleActivate}>
          Activate
        </Button>
      )}
      {currentUses === 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null)
            setConfirm('delete')
          }}
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}

      {/* Deactivate = stop a LIVE promo: no more redemptions until reactivated. */}
      <Dialog
        open={confirm === 'deactivate'}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent data-testid="promo-deactivate-confirm">
          <DialogHeader>
            <DialogTitle>Deactivate promo code</DialogTitle>
            <DialogDescription>
              This stops a live promo immediately — Customers can no longer redeem
              it for Outvers credit until it is reactivated. Existing grants are
              unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeactivate} disabled={isPending}>
              Deactivate
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete = permanently remove a 0-use promo (ADR-0004). Terminal. */}
      <Dialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent data-testid="promo-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete promo code</DialogTitle>
            <DialogDescription>
              This permanently removes the promo code. It has never been redeemed,
              so nothing is reversed — but this cannot be undone. To stop a live
              promo without removing it, deactivate it instead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
