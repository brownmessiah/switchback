'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { toggleSuspendAction } from './actions'

interface SuspendToggleFormProps {
  vendorUserId: string
  suspended: boolean
}

/**
 * #101 — Suspend / Reactivate in the Evidence Cockpit decision rail.
 *
 * SUSPEND is destructive: a suspended Vendor can NOT take new Bookings. It
 * previously fired inline UNGUARDED — a misclick suspended a real Vendor. It is
 * now gated behind a plain confirm Dialog (mirroring the sub-admin revoke
 * pattern) that RESTATES the consequence before commit; the action fires ONLY
 * from the explicit "Confirm Suspend" inside.
 *
 * REACTIVATE restores a suspended Vendor — non-destructive — so it keeps its
 * inline submit. Both go through ONE `useActionState` form so the success state
 * survives the `revalidatePath` re-render (which flips the `suspended` prop and
 * re-renders this component): the message is derived from the post-action
 * `suspended` prop exactly like the original. The action is UNCHANGED with the
 * same FormData inputs; #suspend-notes + the trigger/confirmation names are
 * preserved for the #22 E2E.
 */
export function SuspendToggleForm({ vendorUserId, suspended }: SuspendToggleFormProps) {
  const [state, action, pending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, formData: FormData) => {
      const result = await toggleSuspendAction(formData)
      if (result.ok) {
        setConfirmOpen(false)
        return { ok: true }
      }
      return { ok: false, error: 'error' in result ? result.error : 'Failed' }
    },
    null,
  )

  // For suspend, the form's submit opens the confirm; the confirm hosts the
  // SAME `action` form so the destructive write fires only from inside it.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notes, setNotes] = useState('')

  if (suspended) {
    // ── Reactivate (inline) ──────────────────────────────────────────────
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="vendorUserId" value={vendorUserId} />
        <div className="space-y-[var(--space-field)]">
          <Label htmlFor="suspend-notes">Reactivation Notes (required)</Label>
          <Textarea
            id="suspend-notes"
            name="notes"
            placeholder="e.g. Issue resolved, reinstated."
            required
            minLength={1}
            rows={2}
          />
        </div>
        {state && !state.ok && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}
        {/* This branch renders post-revalidation when suspended=true, i.e. right
            AFTER a successful SUSPEND — so the success confirmation here is
            "Vendor suspended." (preserved for the #22 E2E). */}
        {state?.ok && (
          <p className="text-sm text-success" role="status">
            Vendor suspended.
          </p>
        )}
        <Button type="submit" disabled={pending} variant="default" size="sm" className="w-full">
          {pending ? 'Reactivating...' : 'Reactivate Vendor'}
        </Button>
      </form>
    )
  }

  // ── Suspend (gated behind a confirm Dialog) ─────────────────────────────
  return (
    <div className="space-y-3">
      <div className="space-y-[var(--space-field)]">
        <Label htmlFor="suspend-notes">Suspension Notes (required)</Label>
        <Textarea
          id="suspend-notes"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Repeated policy violations."
          minLength={1}
          rows={2}
        />
      </div>
      {/* This branch renders post-revalidation when suspended=false, i.e. right
          AFTER a successful REACTIVATE (or the initial active state) — so a
          successful action here confirms "Vendor reactivated." (preserved for
          the #22 E2E). A failed suspend attempt also keeps us here → error. */}
      {state?.ok && (
        <p className="text-sm text-success" role="status">
          Vendor reactivated.
        </p>
      )}
      {state && !state.ok && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="w-full"
        disabled={pending || notes.trim().length === 0}
        onClick={() => setConfirmOpen(true)}
      >
        Suspend Vendor
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md" data-testid="suspend-vendor-confirm">
          <DialogHeader>
            <DialogTitle>Suspend this Vendor</DialogTitle>
            <DialogDescription>
              While suspended, the Vendor <span className="font-medium">cannot take new
              Bookings</span> and their published Experiences stop accepting reservations.
              You can reactivate them later. This is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-[var(--radius-md)] border bg-muted/40 px-3 py-2 text-sm text-foreground">
            {notes}
          </p>

          {state && !state.ok && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          {/* The destructive write — fires ONLY from this explicit confirm. The
              SAME `action` is used, with the captured notes, so toggleSuspendAction
              receives identical FormData inputs. */}
          <form action={action}>
            <input type="hidden" name="vendorUserId" value={vendorUserId} />
            <input type="hidden" name="notes" value={notes} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? 'Suspending…' : 'Confirm Suspend'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
