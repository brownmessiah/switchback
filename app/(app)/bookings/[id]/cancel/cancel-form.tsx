'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { cancelBookingAction, type CancelBookingResult } from './actions'

interface CancelFormProps {
  bookingId: string
  cancellationPreset: string
}

/**
 * Customer cancel-confirmation form (Task 14). Renders a single confirm
 * button bound to `cancelBookingAction`. On success it surfaces the WIRED
 * outcome — either an inside-policy auto-credit to the Refund balance, or
 * an outside-policy Dispute routed to support — so the E2E suite can assert
 * the real branch the server took (not just the pure refund math, which is
 * covered at the integration layer in #33).
 */
export function CancelForm({ bookingId, cancellationPreset }: CancelFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<CancelBookingResult | null>(null)

  async function handleCancel() {
    setError('')
    setLoading(true)
    try {
      const result = await cancelBookingAction(bookingId)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setOutcome(result)
      // Refresh server components (dashboard wallet/booking state) on
      // navigation back so the credited Refund balance is reflected.
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (outcome?.ok) {
    return (
      <div
        className="rounded-lg border border-primary/30 bg-primary/5 p-6"
        data-testid="cancel-outcome"
        data-routed-to-dispute={outcome.routedToDispute ? 'true' : 'false'}
      >
        {outcome.routedToDispute ? (
          <>
            <h2 className="text-lg font-semibold">Cancellation under review</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your experience has already started, so this cancellation falls
              outside the policy window. We&apos;ve opened a support case and our
              team will review it. No automatic refund has been issued.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Booking cancelled</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We&apos;ve credited{' '}
              <span className="font-medium text-foreground">
                ₹{outcome.refundAmountRupees.toLocaleString('en-IN')}
              </span>{' '}
              to your Refund balance. It&apos;s ready to use on your next booking
              or to cash out to your original payment method.
            </p>
          </>
        )}
        <a
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to my bookings
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          This booking follows the{' '}
          <span className="font-medium capitalize text-foreground">
            {cancellationPreset}
          </span>{' '}
          cancellation policy. Inside-policy cancellations credit your Refund
          balance automatically; cancellations after the policy window are
          reviewed by our support team.
        </p>
      </div>

      {error && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row">
        <Button
          variant="destructive"
          className="flex-1"
          onClick={handleCancel}
          disabled={loading}
          data-testid="confirm-cancel"
        >
          {loading ? 'Cancelling…' : 'Confirm cancellation'}
        </Button>
        <a
          href={`/bookings/${bookingId}/confirmation`}
          className="min-tap flex flex-1 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-medium hover:bg-muted"
        >
          Keep my booking
        </a>
      </div>
    </div>
  )
}
