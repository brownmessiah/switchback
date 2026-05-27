'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { vendorCancelAction } from './actions'

interface VendorCancelButtonProps {
  bookingId: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export function VendorCancelButton({ bookingId, size = 'sm' }: VendorCancelButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  if (!isOpen) {
    return (
      <Button
        size={size}
        variant="destructive"
        onClick={() => setIsOpen(true)}
      >
        Cancel Booking
      </Button>
    )
  }

  function handleSubmit() {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('A cancellation reason is required.')
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await vendorCancelAction({
        bookingId,
        reason: trimmed,
      })

      if (result.ok) {
        router.refresh()
        setIsOpen(false)
        setReason('')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="Reason for cancellation (required)..."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={isPending}
        rows={2}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={handleSubmit}
          disabled={isPending}
        >
          {isPending ? 'Cancelling...' : 'Confirm Cancellation'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsOpen(false)
            setReason('')
            setError(null)
          }}
          disabled={isPending}
        >
          Back
        </Button>
      </div>
    </div>
  )
}
