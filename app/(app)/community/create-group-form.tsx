'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createGroupAction } from './actions'

function csv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function CreateGroupForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSubmit(formData: FormData) {
    setError('')
    const name = String(formData.get('name') ?? '')
    const maxMembers = Number(formData.get('maxMembers') ?? 6)
    const visibility = String(formData.get('visibility') ?? 'public_all') as
      | 'private'
      | 'public_all'
      | 'public_women_only'
    const membershipRule = String(formData.get('membershipRule') ?? 'auto_accept') as
      | 'auto_accept'
      | 'host_approval'
    const destinationSlugs = csv(String(formData.get('destinations') ?? ''))
    const interestTags = csv(String(formData.get('interests') ?? ''))

    startTransition(async () => {
      const result = await createGroupAction({
        name,
        maxMembers,
        visibility,
        membershipRule,
        destinationSlugs,
        interestTags,
      })
      if (result.ok) {
        router.push(`/community/${result.groupId}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Trip name</Label>
        <Input id="name" name="name" required maxLength={120} placeholder="Rishikesh rafting, October" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="destinations">Destinations</Label>
        <Input id="destinations" name="destinations" placeholder="rishikesh, manali" />
        <p className="text-xs text-muted-foreground">Comma-separated region slugs.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="interests">Interests</Label>
        <Input id="interests" name="interests" placeholder="rafting, trekking" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="maxMembers">Group size</Label>
          <Input id="maxMembers" name="maxMembers" type="number" min={2} max={12} defaultValue={6} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="membershipRule">Joining</Label>
          <select
            id="membershipRule"
            name="membershipRule"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            defaultValue="auto_accept"
          >
            <option value="auto_accept">Anyone can join</option>
            <option value="host_approval">I approve joins</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="visibility">Visibility</Label>
        <select
          id="visibility"
          name="visibility"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          defaultValue="public_all"
        >
          <option value="public_all">Public</option>
          <option value="public_women_only">Women-verified only</option>
          <option value="private">Private (invite-only)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Women-verified groups require Aadhaar-verified-female members.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Creating…' : 'Create trip group'}
      </Button>
    </form>
  )
}
