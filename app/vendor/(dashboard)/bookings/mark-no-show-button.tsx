'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

import { markNoShowAction } from './actions'

interface MarkNoShowButtonProps {
  bookingId: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

/**
 * Vendor action: attest a customer no-show (ADR-0003 rev 2026-06-01). Shown only
 * once the slot has ended and the booking is still confirmed/awaiting_completion.
 * Terminal — no customer refund. Outline/secondary styling so it never competes
 * with the affirmative "Mark Complete".
 */
export function MarkNoShowButton({ bookingId, size = 'sm' }: MarkNoShowButtonProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    if (
      !confirm(
        'Mark this booking as a customer no-show? This is final and issues no refund.',
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await markNoShowAction(bookingId)
      if (result.ok) {
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Button size={size} variant="outline" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Marking...' : 'Mark No-Show'}
    </Button>
  )
}
