'use client'

import Link from 'next/link'
import type { ReactElement } from 'react'
import { useState, useTransition } from 'react'
import Script from 'next/script'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

import { ParticipantsStepper } from '@/components/search/participants-stepper'
import { buttonVariants } from '@/components/ui/button'
import type { CartView as CartViewData } from '@/lib/cart/core'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { checkoutCartAction, removeFromCartAction, updateCartItemAction } from './actions'
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
  /** Session identity for the Razorpay prefill (never money-bearing). */
  readonly customerName?: string
  readonly customerEmail?: string
}

export function CartView({ initialCart, customerName, customerEmail }: CartViewProps): ReactElement {
  const router = useRouter()
  const [cart, setCart] = useState(initialCart)
  const [isPending, startTransition] = useTransition()
  const [acknowledged, setAcknowledged] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  // A dismissed pay-sheet must NOT strand the (already-created) bookings:
  // the order id is kept so "Resume payment" re-opens the same order.
  const [pendingPayment, setPendingPayment] = useState<{
    razorpayOrderId: string
    amountRupees: number
    keyId: string
  } | null>(null)

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

  async function onCheckout(): Promise<void> {
    setCheckingOut(true)
    try {
      const result = await checkoutCartAction({
        idempotencyKey: crypto.randomUUID(),
        acknowledgedPermits: acknowledged,
      })
      if (!result.ok) {
        toast.error(result.message)
        setCheckingOut(false)
        return
      }
      broadcastCartCount(0)
      if (result.paymentSetupFailed) {
        toast.error(
          'Your bookings were created but payment setup could not start. Our team will follow up — you have not been charged yet.',
        )
        router.push('/bookings')
        return
      }
      if (!result.razorpayOrderId || result.razorpayRemainderRupees <= 0) {
        // Wallet fully funded the order (ADR-0004 wallet-before-Razorpay).
        toast.success('Booked! Your wallet covered the full amount.')
        router.push('/bookings')
        return
      }
      if (typeof window === 'undefined' || !window.Razorpay) {
        toast.error('Payment could not be started. Please reload and try again.')
        setCheckingOut(false)
        return
      }
      openPaySheet({
        razorpayOrderId: result.razorpayOrderId,
        amountRupees: result.razorpayRemainderRupees,
        keyId: result.keyId,
      })
    } catch {
      toast.error('Checkout failed. Please try again.')
      setCheckingOut(false)
    }
  }

  function openPaySheet(payment: {
    razorpayOrderId: string
    amountRupees: number
    keyId: string
  }): void {
    new window.Razorpay({
      key: payment.keyId,
      amount: payment.amountRupees * 100,
      currency: 'INR',
      name: 'Switchback',
      description:
        cart.items.length === 1 ? '1 experience' : `${cart.items.length} experiences`,
      order_id: payment.razorpayOrderId,
      prefill: { name: customerName ?? '', email: customerEmail ?? '', contact: '' },
      // The webhook is the authoritative capture; this only advances the UI.
      handler: () => {
        setPendingPayment(null)
        router.push('/bookings')
      },
      modal: {
        ondismiss: () => {
          // The bookings/order are already committed — keep the order id so
          // payment can be RESUMED (never stranded behind a cleared cart).
          setPendingPayment(payment)
          toast.error('Payment was not completed. You have not been charged — resume when ready.')
          setCheckingOut(false)
        },
      },
    }).open()
  }

  if (pendingPayment) {
    return (
      <div className="mt-10 flex flex-col items-start gap-4" data-testid="cart-pending-payment">
        <p className="text-muted-foreground">
          Your bookings are reserved but not yet paid. Resume payment to
          confirm them.
        </p>
        <button
          type="button"
          onClick={() => openPaySheet(pendingPayment)}
          className={cn(buttonVariants({ size: 'lg' }))}
        >
          Resume payment
        </button>
      </div>
    )
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

      {/* Permits acknowledgement (ADR consent gate): createBooking refuses
          permit-requiring Experiences without it — one consent covers the
          cart, mirroring the single-item checkout page's notice. */}
      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          data-testid="cart-permits-ack"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        I acknowledge any permits these experiences require and confirm the
        participant details are correct.
      </label>

      {/* Multi-item checkout (issue 12, ADR-0021): all-or-nothing — N
          bookings in one transaction, ONE Razorpay payment for the total. */}
      <button
        type="button"
        disabled={!acknowledged || checkingOut || isPending}
        data-testid="cart-checkout"
        onClick={onCheckout}
        className={cn(buttonVariants({ size: 'lg' }), 'w-full disabled:opacity-60')}
      >
        {checkingOut ? 'Processing…' : 'Proceed to checkout'}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        You pay once for everything; each experience becomes its own booking
        with its own cancellation policy.
      </p>

      {/* Razorpay checkout.js — eager so window.Razorpay exists by pay time. */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
    </div>
  )
}
