'use client'

import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Minus, Plus } from 'lucide-react'

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { quoteCheckout } from '@/lib/payments/group-size-bracket'

import { writeAbandonmentAudit } from './abandonment-action'
import { startCheckoutAction } from './actions'

// The Razorpay checkout.js script injects this global. We model only the
// surface we use (`open()` / `on()`). This is the single source of the
// `Window.Razorpay` declaration — the standalone RazorpayCheckoutButton that
// previously duplicated it has been deleted (#15).
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, handler: () => void) => void
    }
  }
}

interface CheckoutFormProps {
  experienceId: string
  experienceTitle: string
  slotId: string | null
  /** When set, this Booking is a seat in a TripGroup (ADR-0009) — tagged but
   *  still a normal per-member Booking; validated server-side. */
  tripGroupId?: string | null
  /** Initial participant count (from the PDP link / query); editable below. */
  participantCount: number
  /** Upper bound for the stepper — the slot's remaining capacity. */
  maxParticipants: number
  priceTier12: number
  priceTier35: number
  priceTier6: number
  cancellationPreset: string
  paymentModesAllowed: string[]
  customerName: string | null
  customerEmail: string | null
}

type Step = 'details' | 'payment'
type PaymentMode = 'partial_pay' | 'full_upfront'

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

export function CheckoutForm({
  experienceId,
  experienceTitle,
  slotId,
  tripGroupId,
  participantCount,
  maxParticipants,
  priceTier12,
  priceTier35,
  priceTier6,
  cancellationPreset,
  paymentModesAllowed,
  customerName,
  customerEmail,
}: CheckoutFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<Step>('details')

  const supportsPartialPay = paymentModesAllowed.includes('partial_pay')

  // Participant count is editable — the price bracket, gross, and 25% advance
  // all re-resolve live as it changes. The SERVER (createBooking) re-resolves +
  // snapshots the authoritative price at create; this quote is display-only.
  const [count, setCount] = useState(
    Math.min(Math.max(1, participantCount), Math.max(1, maxParticipants)),
  )
  const quote = quoteCheckout(
    { tier12: priceTier12, tier35: priceTier35, tier6: priceTier6 },
    count,
    supportsPartialPay,
  )
  const pricePerPerson = quote.pricePerPerson
  const grossTotal = quote.gross
  const advanceAmount = quote.advance
  const remainderAmount = quote.balance
  const canDecrement = count > 1
  const canIncrement = count < maxParticipants

  // Default to partial_pay whenever the Experience allows it — this preserves
  // the money invariant the Revenue-spine E2E asserts (booking.paymentMode ===
  // 'partial_pay'). The full-upfront radio is offered only as an alternative.
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    supportsPartialPay ? 'partial_pay' : 'full_upfront',
  )

  const payAmount = paymentMode === 'partial_pay' ? advanceAmount : grossTotal

  function goToConfirmation(bookingId: string) {
    router.push(`/bookings/${bookingId}/confirmation`)
  }

  async function handleCheckout() {
    setError('')
    setLoading(true)

    let result: Awaited<ReturnType<typeof startCheckoutAction>>
    try {
      result = await startCheckoutAction({
        experienceId,
        slotId: slotId ?? '',
        customerUserId: '',
        participantCount: count,
        paymentMode,
        acknowledgedPermits: true,
        ...(tripGroupId ? { tripGroupId } : {}),
        // booking-create requires a UUID idempotency key (z.string().uuid()).
        // A non-UUID key (e.g. `checkout-<id>-<ts>`) fails the parse and the
        // whole checkout silently errors — Issue #13.
        idempotencyKey: crypto.randomUUID(),
      })
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    if (!result.ok) {
      setError(result.message)
      setLoading(false)
      return
    }

    // Wallet fully funded the booking (ADR-0004 wallet-before-Razorpay): there
    // is no Razorpay remainder to collect, so confirm directly. `orderId` is
    // null and `amountRupees` is 0 in this case.
    if (result.orderId == null || result.amountRupees <= 0) {
      goToConfirmation(result.bookingId)
      return
    }

    // There is a real charge to collect — mount the Razorpay pay-sheet. The
    // webhook is the authoritative capture; this handler only advances the UI.
    if (typeof window === 'undefined' || !window.Razorpay) {
      setError('Payment could not be started. Please reload and try again.')
      setLoading(false)
      return
    }

    const bookingId = result.bookingId
    const options = {
      key: result.keyId,
      amount: result.amountRupees * 100,
      currency: 'INR',
      name: 'Outvers',
      description: experienceTitle,
      order_id: result.orderId,
      prefill: {
        name: customerName ?? '',
        email: customerEmail ?? '',
        contact: '',
      },
      // Payment SUCCESS — the ONLY path that reaches the confirmation page.
      // We do NOT clear `loading` here: navigation unmounts the form.
      handler: () => {
        goToConfirmation(bookingId)
      },
      modal: {
        // Sheet dismissed without paying — record the abandonment for audit,
        // stay on checkout, and surface a gentle nudge. Never a false success.
        ondismiss: async () => {
          await writeAbandonmentAudit(bookingId)
          setError('Payment was not completed. You have not been charged.')
          setLoading(false)
        },
      },
    }

    new window.Razorpay(options).open()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      {/* Razorpay checkout.js — loaded eagerly so window.Razorpay exists by the
          time the customer reaches the Pay button on step 2 (#15). */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />
      {/* ── Main column: the guided stepper ─────────────────────────────── */}
      <div className="space-y-6">
        {/* Stepper header — step 1 "Your details" → step 2 "Payment" */}
        <ol className="flex items-center gap-3 text-sm" aria-label="Checkout steps">
          <StepPip
            index={1}
            label="Your details"
            active={step === 'details'}
            complete={step === 'payment'}
          />
          <Separator className="h-px flex-1" />
          <StepPip
            index={2}
            label="Payment"
            active={step === 'payment'}
            complete={false}
          />
        </ol>

        {/* ── STEP 1 — Your details (review) ─────────────────────────────── */}
        {step === 'details' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Your details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Booking under your signed-in Outvers account. Review and continue
                  to payment.
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">
                    {customerName ?? 'Signed-in customer'}
                  </span>
                </div>
                {customerEmail && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium">{customerEmail}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Group size — editable; re-resolves the price bracket + totals live */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Group size</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Number of people</span>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Remove one participant"
                      onClick={() => setCount((c) => Math.max(1, c - 1))}
                      disabled={!canDecrement}
                    >
                      <Minus aria-hidden="true" className="size-4" />
                    </Button>
                    <span
                      data-testid="participant-count"
                      aria-live="polite"
                      className="w-8 text-center text-lg font-semibold tabular-nums"
                    >
                      {count}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Add one participant"
                      onClick={() => setCount((c) => Math.min(maxParticipants, c + 1))}
                      disabled={!canIncrement}
                    >
                      <Plus aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatRupees(pricePerPerson)} / person · up to {maxParticipants} seats on this slot.
                </p>
              </CardContent>
            </Card>

            {/* Cancellation policy (surfaced on the review step) */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Badge variant="success" className="capitalize">
                    <CheckCircle2 aria-hidden="true" />
                    {cancellationPreset}
                  </Badge>
                  <span className="text-sm text-muted-foreground">cancellation policy</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Inside-policy cancellations credit your Outvers wallet within 24 hours.
                </p>
              </CardContent>
            </Card>

            <Button className="w-full" size="lg" onClick={() => setStep('payment')}>
              Continue to payment
            </Button>
          </div>
        )}

        {/* ── STEP 2 — Payment ───────────────────────────────────────────── */}
        {step === 'payment' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {supportsPartialPay ? (
                  <RadioGroup
                    value={paymentMode}
                    onValueChange={(val) => setPaymentMode(val as PaymentMode)}
                    aria-label="Payment mode"
                  >
                    <label
                      htmlFor="pay-partial"
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
                    >
                      <RadioGroupItem
                        value="partial_pay"
                        id="pay-partial"
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">
                          Pay 25% now (Advance)
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatRupees(advanceAmount)} now ·{' '}
                          {formatRupees(remainderAmount)} auto-captured 24 hours
                          before the experience.
                        </span>
                      </span>
                    </label>

                    <label
                      htmlFor="pay-full"
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
                    >
                      <RadioGroupItem value="full_upfront" id="pay-full" className="mt-0.5" />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">Pay in full</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatRupees(grossTotal)} charged now.
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {formatRupees(grossTotal)} is charged now to confirm your Booking.
                  </p>
                )}

                <div className="flex items-start gap-2 rounded-lg bg-info-subtle p-3">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-info"
                  />
                  <p className="text-xs text-info">
                    Secure payment. You can cancel under the policy shown for a refund
                    to your Outvers wallet.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
              >
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleCheckout}
              disabled={loading}
            >
              {loading ? 'Processing...' : `Pay ${formatRupees(payAmount)}`}
            </Button>

            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              onClick={() => setStep('details')}
              disabled={loading}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          By proceeding, you agree to the cancellation policy and terms of service.
        </p>
      </div>

      {/* ── Persistent order-summary rail (sticky, visible on BOTH steps) ── */}
      <aside aria-label="Order summary" className="lg:sticky lg:top-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Order summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Experience</span>
              <span className="text-right font-medium">{experienceTitle}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Participants</span>
              <span className="tabular-nums">{count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Price per person</span>
              <span className="tabular-nums">{formatRupees(pricePerPerson)}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="font-medium">Total</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatRupees(grossTotal)}
              </span>
            </div>

            {supportsPartialPay && (
              <>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pay now (25%)</span>
                  <span className="font-medium tabular-nums">
                    {formatRupees(advanceAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="tabular-nums">{formatRupees(remainderAmount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  The balance is auto-captured 24 hours before the experience starts.
                </p>
              </>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Badge variant="success">
                <CheckCircle2 aria-hidden="true" />
                Free cancellation
              </Badge>
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

interface StepPipProps {
  index: number
  label: string
  active: boolean
  complete: boolean
}

function StepPip({ index, label, active, complete }: StepPipProps) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={
          active || complete
            ? 'flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground'
            : 'flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground'
        }
      >
        {index}
      </span>
      <span
        className={
          active
            ? 'font-medium text-foreground'
            : 'text-muted-foreground'
        }
        aria-current={active ? 'step' : undefined}
      >
        {label}
      </span>
    </li>
  )
}
