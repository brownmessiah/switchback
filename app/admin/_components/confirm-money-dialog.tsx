'use client'

import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { formatRupees } from './money'

/**
 * Shared A4 exact-figure confirm Dialog for admin money queues (DESIGN.md §4 A4).
 *
 * Every money-moving admin action (approve / hold / reject a Payout, approve /
 * reject a Refund, change a Commission rate) MUST restate the EXACT rupee
 * figure being moved before the operator confirms — a misclick must never move
 * money, because the action only fires from the explicit Confirm control inside
 * this Dialog, never inline.
 *
 * Token-true + English-only (admin is English-only). The restated figure is
 * rendered in `.tabular-nums` per DESIGN.md §1.3 / §2.2.
 */
export interface ConfirmMoneyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog heading (e.g. "Approve Payout"). */
  title: string
  /** Label on the confirm button (e.g. "Approve Payout"). */
  actionLabel: string
  /** The exact integer-rupee figure being moved; restated before confirm. */
  amountRupees: number
  onConfirm: () => void
  /** Optional sentence shown above the figure (defaults to a generic restate). */
  description?: ReactNode
  /** Optional supporting content (amount field, reason textarea, breakdown). */
  children?: ReactNode
  /** Optional override for the figure's caption line. */
  amountCaption?: string
  /** Confirm button variant; defaults to the coral primary. */
  confirmVariant?: 'default' | 'destructive'
  /** Disable confirm while a transition is in flight or input is invalid. */
  confirmDisabled?: boolean
  /** Optional error string rendered below the body. */
  error?: string | null
  /** Optional test id placed on the DialogContent (e.g. "grant-credit-confirm"). */
  dialogTestId?: string
}

export function ConfirmMoneyDialog({
  open,
  onOpenChange,
  title,
  actionLabel,
  amountRupees,
  onConfirm,
  description,
  children,
  amountCaption,
  confirmVariant = 'default',
  confirmDisabled = false,
  error,
  dialogTestId,
}: ConfirmMoneyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={dialogTestId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              'Confirm the exact amount below. This moves real money and is recorded in the audit log.'}
          </DialogDescription>
        </DialogHeader>

        {/* The load-bearing A4 restatement: the EXACT figure, in tabular-nums. */}
        <div className="rounded-[var(--radius-md)] border bg-muted/40 px-4 py-3 text-center">
          <p
            data-testid="confirm-money-amount"
            className="text-2xl font-semibold tabular-nums tracking-tight"
          >
            {formatRupees(amountRupees)}
          </p>
          {amountCaption && (
            <p className="mt-1 text-xs text-muted-foreground">{amountCaption}</p>
          )}
        </div>

        {children}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
