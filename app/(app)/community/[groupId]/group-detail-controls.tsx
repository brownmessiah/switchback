'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  addSlotAction,
  approveMemberAction,
  declineMemberAction,
  deleteSlotAction,
  joinGroupAction,
  leaveGroupAction,
  lockItineraryAction,
} from '../actions'

function useAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError('')
    startTransition(async () => {
      const r = await fn()
      if (r.ok) router.refresh()
      else setError(r.error ?? 'Something went wrong.')
    })
  }
  return { isPending, error, run }
}

export function JoinButton({ groupId }: { groupId: string }) {
  const { isPending, error, run } = useAction()
  return (
    <span className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={isPending} onClick={() => run(() => joinGroupAction(groupId))}>
        {isPending ? 'Joining…' : 'Join trip'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

export function LeaveButton({ groupId }: { groupId: string }) {
  const { isPending, error, run } = useAction()
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run(() => leaveGroupAction(groupId))}
      >
        {isPending ? 'Leaving…' : 'Leave'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

export function LockItineraryButton({ groupId }: { groupId: string }) {
  const { isPending, error, run } = useAction()
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => {
          if (confirm('Lock the itinerary so members can book? Joins close after this.'))
            run(() => lockItineraryAction(groupId))
        }}
      >
        {isPending ? 'Locking…' : 'Lock itinerary'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

export function DeleteSlotButton({ slotId, groupId }: { slotId: string; groupId: string }) {
  const { isPending, run } = useAction()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={isPending}
      onClick={() => run(() => deleteSlotAction(slotId, groupId))}
      aria-label="Remove this plan"
    >
      Remove
    </Button>
  )
}

export function HostRequestControls({
  groupId,
  memberUserId,
  memberName,
}: {
  groupId: string
  memberUserId: string
  memberName: string
}) {
  const { isPending, run } = useAction()
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{memberName}</span>
      <span className="flex gap-1">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => run(() => approveMemberAction(groupId, memberUserId))}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => run(() => declineMemberAction(groupId, memberUserId))}
        >
          Decline
        </Button>
      </span>
    </div>
  )
}

export function AddSlotForm({ groupId }: { groupId: string }) {
  const { isPending, error, run } = useAction()
  const [day, setDay] = useState('1')
  const [band, setBand] = useState('morning')
  const [plan, setPlan] = useState('')

  function submit() {
    const dayOffset = Math.max(0, Number(day) - 1)
    run(() =>
      addSlotAction({
        groupId,
        dayOffset,
        timeBand: band.trim() || 'morning',
        freeText: plan.trim() || null,
      }).then((r) => {
        if (r.ok) setPlan('')
        return r
      }),
    )
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[4rem_1fr] gap-2">
        <Input
          aria-label="Day"
          type="number"
          min={1}
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <Input
          aria-label="Time band"
          value={band}
          onChange={(e) => setBand(e.target.value)}
          placeholder="morning"
        />
      </div>
      <Input
        aria-label="Plan"
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        placeholder="What's the plan? (e.g. Rafting at Shivpuri)"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" className="w-full" disabled={isPending || !plan.trim()} onClick={submit}>
        {isPending ? 'Adding…' : 'Add to itinerary'}
      </Button>
    </div>
  )
}
