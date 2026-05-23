'use client'

import Script from 'next/script'
import { useCallback, useState } from 'react'

import { writeAbandonmentAudit } from './abandonment-action'

interface RazorpayCheckoutButtonProps {
  orderId: string
  amountRupees: number
  keyId: string
  bookingId: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  onSuccess: (response: {
    razorpay_payment_id: string
    razorpay_order_id: string
    razorpay_signature: string
  }) => void
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, handler: () => void) => void
    }
  }
}

export function RazorpayCheckoutButton({
  orderId,
  amountRupees,
  keyId,
  bookingId,
  customerName,
  customerEmail,
  customerPhone,
  onSuccess,
}: RazorpayCheckoutButtonProps) {
  const [sdkReady, setSdkReady] = useState(false)
  const [opening, setOpening] = useState(false)

  const handleClick = useCallback(() => {
    if (!sdkReady || !window.Razorpay) return
    setOpening(true)

    const options = {
      key: keyId,
      amount: amountRupees * 100,
      currency: 'INR',
      name: 'Outvers',
      description: 'Experience Booking',
      order_id: orderId,
      prefill: {
        name: customerName ?? '',
        email: customerEmail ?? '',
        contact: customerPhone ?? '',
      },
      handler: (response: {
        razorpay_payment_id: string
        razorpay_order_id: string
        razorpay_signature: string
      }) => {
        setOpening(false)
        onSuccess(response)
      },
      modal: {
        ondismiss: async () => {
          setOpening(false)
          await writeAbandonmentAudit(bookingId)
        },
      },
    }

    const rzp = new window.Razorpay(options)
    rzp.open()
  }, [
    sdkReady,
    keyId,
    amountRupees,
    orderId,
    customerName,
    customerEmail,
    customerPhone,
    bookingId,
    onSuccess,
  ])

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
        onReady={() => setSdkReady(true)}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={!sdkReady || opening}
      >
        {opening ? 'Processing...' : `Pay ₹${amountRupees}`}
      </button>
    </>
  )
}
