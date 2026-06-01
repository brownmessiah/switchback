'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { replySupportTicketAction } from '../actions'

interface ReplyFormProps {
  ticketId: string
}

export function ReplyForm({ ticketId }: ReplyFormProps) {
  const t = useTranslations('SupportPage')
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleSubmit(formData: FormData) {
    const body = String(formData.get('body') ?? '').trim()
    setError(null)
    setSuccess(false)
    if (!body) return

    startTransition(async () => {
      const res = await replySupportTicketAction(ticketId, body)
      if (res.ok) {
        setSuccess(true)
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
      data-testid="reply-form"
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="body">{t('reply.label')}</Label>
        <Textarea
          id="body"
          name="body"
          placeholder={t('reply.placeholder')}
          rows={3}
          required
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-success" role="status" data-testid="reply-success">
          {t('reply.success')}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? t('reply.submitting') : t('reply.submit')}
      </Button>
    </form>
  )
}
