'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
}: CheckoutFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supportsPartialPay = paymentModesAllowed.includes('partial_pay')
  const advanceAmount = supportsPartialPay ? Math.floor(grossTotal * 0.25) : grossTotal
  const remainderAmount = grossTotal - advanceAmount

  async function handleCheckout() {
    setError('')
    setLoading(true)

    try {
      const result = await startCheckoutAction({
        experienceId,
        slotId: slotId ?? '',
        customerUserId: '',
        participantCount,
        paymentMode: supportsPartialPay ? 'partial_pay' : 'full_upfront',
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
    <div className="space-y-6">
      {/* Order summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Order summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Experience</span>
            <span className="font-medium">{experienceTitle}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Participants</span>
            <span>{participantCount}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Price per person</span>
            <span>₹{pricePerPerson.toLocaleString('en-IN')}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="font-medium">Total</span>
            <span className="text-lg font-semibold">
              ₹{grossTotal.toLocaleString('en-IN')}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Payment breakdown */}
      {supportsPartialPay && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payment breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due now (25%)</span>
              <span className="font-medium">₹{advanceAmount.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due 24h before experience</span>
              <span>₹{remainderAmount.toLocaleString('en-IN')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              The remaining amount is auto-captured 24 hours before the experience starts.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Cancellation policy */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {cancellationPreset}
            </Badge>
            <span className="text-sm text-muted-foreground">cancellation policy</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Inside-policy cancellations credit your Outvers wallet within 24 hours.
          </p>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Pay button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleCheckout}
        disabled={loading}
      >
        {loading
          ? 'Processing...'
          : supportsPartialPay
            ? `Pay ₹${advanceAmount.toLocaleString('en-IN')} now`
            : `Pay ₹${grossTotal.toLocaleString('en-IN')}`}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        By proceeding, you agree to the cancellation policy and terms of service.
      </p>
    </div>
  )
}
