'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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

import { createSupportTicketAction } from './actions'

const CATEGORIES = [
  'booking',
  'payment',
  'experience',
  'account',
  'cancellation',
  'other',
] as const

export function NewTicketForm() {
  const t = useTranslations('SupportPage')
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [category, setCategory] = useState<string>('other')

  function handleSubmit(formData: FormData) {
    const subject = String(formData.get('subject') ?? '').trim()
    const message = String(formData.get('message') ?? '').trim()
    setError(null)
    setSuccess(false)

    if (!subject || !message) {
      setError(t('form.validationError'))
      return
    }

    startTransition(async () => {
      const res = await createSupportTicketAction(subject, category, message)
      if (res.ok) {
        setSuccess(true)
        setCategory('other')
        formRef.current?.reset()
        router.refresh()
      } else if (res.error === 'unauthenticated') {
        router.push('/sign-in')
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      data-testid="new-ticket-form"
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="subject">{t('form.subjectLabel')}</Label>
          <Input
            id="subject"
            name="subject"
            placeholder={t('form.subjectPlaceholder')}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">{t('form.categoryLabel')}</Label>
          <Select value={category} onValueChange={(v) => setCategory(v ?? 'other')}>
            <SelectTrigger id="category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`categories.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="message">{t('form.messageLabel')}</Label>
        <Textarea
          id="message"
          name="message"
          placeholder={t('form.messagePlaceholder')}
          rows={4}
          required
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-success" role="status" data-testid="ticket-success">
          {t('form.success')}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? t('form.submitting') : t('form.submit')}
      </Button>
    </form>
  )
}
