'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { createTicketAction } from './actions'

const PRIORITIES = ['low', 'medium', 'high'] as const
const CATEGORIES = [
  'booking',
  'payment',
  'experience',
  'account',
  'cancellation',
  'other',
] as const

export function TicketCreateForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [priority, setPriority] = useState<string>('medium')
  const [category, setCategory] = useState<string>('other')

  function handleSubmit(formData: FormData) {
    const subject = String(formData.get('subject') ?? '')
    const body = String(formData.get('body') ?? '')
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const res = await createTicketAction(subject, priority, category, body)
      if (res.ok) {
        setSuccess(true)
        setPriority('medium')
        setCategory('other')
        formRef.current?.reset()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      data-testid="ticket-create-form"
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            name="subject"
            placeholder="Short summary of the question"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v ?? 'medium')}>
            <SelectTrigger id="priority" className="w-full">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v ?? 'other')}>
            <SelectTrigger id="category" className="w-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">Message</Label>
        <Textarea
          id="body"
          name="body"
          placeholder="Describe the question or issue..."
          rows={3}
          required
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-600" role="status">
          Ticket created.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Ticket'}
      </Button>
    </form>
  )
}
