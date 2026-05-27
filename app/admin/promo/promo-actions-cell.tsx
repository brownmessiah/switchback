'use client'

import { useTransition } from 'react'

import { Button } from '@/components/ui/button'

import { deletePromoCode, togglePromoCode } from './actions'

interface PromoActionsCellProps {
  id: string
  active: boolean
  currentUses: number
}

export function PromoActionsCell({ id, active, currentUses }: PromoActionsCellProps) {
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    startTransition(async () => {
      await togglePromoCode(id, !active)
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await deletePromoCode(id)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleToggle}
      >
        {active ? 'Deactivate' : 'Activate'}
      </Button>
      {currentUses === 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleDelete}
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      )}
    </div>
  )
}
