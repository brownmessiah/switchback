'use client'

import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'

import { startCheckoutAction } from './actions'

interface CheckoutFormProps {
  experienceId: string
  experienceTitle: string
  slotId: string | null
  participantCount: number
  pricePerPerson: number
  grossTotal: number
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
  participantCount,
  pricePerPerson,
  grossTotal,
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
  const advanceAmount = supportsPartialPay ? Math.floor(grossTotal * 0.25) : grossTotal
  const remainderAmount = grossTotal - advanceAmount

  // Default to partial_pay whenever the Experience allows it — this preserves
  // the money invariant the Revenue-spine E2E asserts (booking.paymentMode ===
  // 'partial_pay'). The full-upfront radio is offered only as an alternative.
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    supportsPartialPay ? 'partial_pay' : 'full_upfront',
  )

  const payAmount = paymentMode === 'partial_pay' ? advanceAmount : grossTotal

  async function handleCheckout() {
    setError('')
    setLoading(true)

    try {
      const result = await startCheckoutAction({
        experienceId,
        slotId: slotId ?? '',
        customerUserId: '',
        participantCount,
        paymentMode,
        acknowledgedPermits: true,
        // booking-create requires a UUID idempotency key (z.string().uuid()).
        // A non-UUID key (e.g. `checkout-<id>-<ts>`) fails the parse and the
        // whole checkout silently errors — Issue #13.
        idempotencyKey: crypto.randomUUID(),
      })

      if (!result.ok) {
        setError(result.message)
        return
      }

      router.push(`/bookings/${result.bookingId}/confirmation`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
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
              <span className="tabular-nums">{participantCount}</span>
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
