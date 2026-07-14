'use client'

import Link from 'next/link'
import type { ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'

import { ParticipantsStepper } from '@/components/search/participants-stepper'
import { buttonVariants } from '@/components/ui/button'
import type { CartView as CartViewData } from '@/lib/cart/core'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { removeFromCartAction, updateCartItemAction } from './actions'
import { broadcastCartCount } from '@/components/cart-indicator'

/**
 * Client island for /cart (issue 11): list, per-line participants stepper
 * (the shared control from issue 07), remove, INR subtotal. "Proceed to
 * checkout" is DELIBERATELY inert until issue 12 wires the multi-item
 * checkout — it renders disabled with an explanatory title rather than
 * shipping a dead-looking link.
 *
 * Un-localized surface (app/(app) convention — mirrors checkout-form.tsx):
 * hardcoded English.
 */

const MAX_PARTICIPANTS = 50

function formatRupees(amount: number): string {
  return amount.toLocaleString('en-IN')
}

interface CartViewProps {
  readonly initialCart: CartViewData
}

export function CartView({ initialCart }: CartViewProps): ReactElement {
  const [cart, setCart] = useState(initialCart)
  const [isPending, startTransition] = useTransition()

  function patchLine(id: string, participantCount: number): void {
    setCart((c) => {
      const items = c.items.map((line) =>
        line.id === id
          ? {
              ...line,
              participantCount,
              lineTotalRupees: line.pricePerParticipantRupees * participantCount,
            }
          : line,
      )
      return {
        items,
        subtotalRupees: items.reduce((sum, l) => sum + l.lineTotalRupees, 0),
      }
    })
  }

  function onCountChange(id: string, next: number): void {
    const previous = cart.items.find((l) => l.id === id)?.participantCount
    patchLine(id, next)
    startTransition(async () => {
      const result = await updateCartItemAction({ cartItemId: id, participantCount: next })
      if (!result.ok) {
        toast.error(result.message)
        // Roll the optimistic edit back — the DB is the truth (review fix:
        // a failed write must not leave a diverged count/subtotal).
        if (previous !== undefined) patchLine(id, previous)
      }
    })
  }

  function onRemove(id: string): void {
    startTransition(async () => {
      const result = await removeFromCartAction({ cartItemId: id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      broadcastCartCount(result.cartCount)
      setCart((c) => {
        const items = c.items.filter((l) => l.id !== id)
        return {
          items,
          subtotalRupees: items.reduce((sum, l) => sum + l.lineTotalRupees, 0),
        }
      })
    })
  }

  if (cart.items.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-start gap-4" data-testid="cart-empty">
        <p className="text-muted-foreground">
          Your cart is empty. Find an experience and add it here to plan a
          multi-activity trip.
        </p>
        <Link href="/search" className={buttonVariants()}>
          Browse experiences
        </Link>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <ul className="flex flex-col gap-3" data-testid="cart-items">
        {cart.items.map((line) => (
          <li
            key={line.id}
            data-testid="cart-item"
            className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <Link
                href={`/experience/${line.experienceSlug}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {line.experienceTitle}
              </Link>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {new Date(line.slotStartAtISO).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                })}
                {line.variationName ? ` · ${line.variationName}` : ''}
              </p>
              <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                ₹{formatRupees(line.pricePerParticipantRupees)} / person
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <ParticipantsStepper
                label="Participants"
                value={line.participantCount}
                min={1}
                max={MAX_PARTICIPANTS}
                disabled={isPending}
                onChange={(next) => onCountChange(line.id, next)}
              />
              <p
                className="min-w-20 text-right font-semibold tabular-nums"
                data-testid="cart-line-total"
              >
                ₹{formatRupees(line.lineTotalRupees)}
              </p>
              <button
                type="button"
                onClick={() => onRemove(line.id)}
                disabled={isPending}
                aria-label={`Remove ${line.experienceTitle}`}
                className="min-tap inline-flex items-center justify-center rounded-[var(--radius-control)] p-2 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">Subtotal</p>
        <p className="text-lg font-bold tabular-nums" data-testid="cart-subtotal">
          ₹{formatRupees(cart.subtotalRupees)}
        </p>
      </div>

      {/* Inert until issue 12 (multi-item checkout per ADR-0021) — present so
          the layout is final, disabled so nothing dead-ends. */}
      <button
        type="button"
        disabled
        data-testid="cart-checkout-inert"
        title="Multi-item checkout is coming next"
        className={cn(buttonVariants({ size: 'lg' }), 'w-full opacity-60')}
      >
        Proceed to checkout
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Multi-item checkout arrives with the next update — items stay saved
        here meanwhile.
      </p>
    </div>
  )
}
