'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

import { markCompleteAction } from './actions'

interface MarkCompleteButtonProps {
  bookingId: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export function MarkCompleteButton({ bookingId, size = 'sm' }: MarkCompleteButtonProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    startTransition(async () => {
      const result = await markCompleteAction(bookingId)
      if (result.ok) {
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Button
      size={size}
      variant="default"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? 'Completing...' : 'Mark Complete'}
    </Button>
  )
}
