'use client'

import Link from 'next/link'
import { MessageCircleQuestion } from 'lucide-react'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { askExperienceQuestionAction } from './ask-question-action'

/** Already-translated copy — resolved on the server PDP and passed in, mirroring
 * how the Booking rail receives pre-translated strings (no client `useTranslations`
 * needed; keeps one translation pass per page). */
export interface AskQuestionLabels {
  cta: string
  dialogTitle: string
  dialogDescription: string
  messageLabel: string
  messagePlaceholder: string
  submit: string
  submitting: string
  success: string
  signedOutPrompt: string
  signIn: string
  cancel: string
  validationError: string
  genericError: string
  /** Toast copy fired when the action is login-gated (issue 24). */
  toastSignInRequired: string
}

interface AskQuestionProps {
  /** Experience reference carried into the ticket — slug + title ONLY (no Vendor PII). */
  experienceSlug: string
  experienceTitle: string
  /** Server-resolved auth state. Signed-out → the dialog shows a sign-in prompt. */
  isSignedIn: boolean
  /** /sign-in link with the current PDP path preserved as the return target. */
  signInHref: string
  labels: AskQuestionLabels
  /** Placement classes (e.g. full-width under the booking card, or compact in the mobile bar). */
  className?: string
  /** When true, renders an icon-only/compact trigger for the mobile sticky bar. */
  compact?: boolean
}

/**
 * AskQuestion — the PDP "Ask a Question" CTA (issue 17, DECISION D6).
 *
 * A Dialog-triggered enquiry form placed near the Booking box (desktop rail) and
 * in the mobile sticky bar. On submit it calls `askExperienceQuestionAction`,
 * which opens a general-enquiry Support Ticket (category 'experience') in the
 * existing admin support queue, referencing the Experience by slug + title only.
 *
 * Login-gated with context preservation: a signed-out visitor still gets the
 * CTA, but the dialog shows a "sign in to ask" prompt linking to `signInHref`
 * (the /sign-in route with this PDP as the return target) — it NEVER submits
 * silently. An `unauthenticated` action result (session expired mid-flow) routes
 * back to the same prompt.
 */
export function AskQuestion({
  experienceSlug,
  experienceTitle,
  isSignedIn,
  signInHref,
  labels,
  className,
  compact = false,
}: AskQuestionProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(!isSignedIn)

  function handleSubmit(formData: FormData) {
    const message = String(formData.get('message') ?? '').trim()
    setError(null)

    if (!message) {
      setError(labels.validationError)
      return
    }

    startTransition(async () => {
      const res = await askExperienceQuestionAction(
        experienceSlug,
        experienceTitle,
        message,
      )
      if (res.ok) {
        setSuccess(true)
        formRef.current?.reset()
      } else if (res.error === 'unauthenticated') {
        setNeedsSignIn(true)
        toast.info(labels.toastSignInRequired)
      } else {
        setError(res.error || labels.genericError)
      }
    })
  }

  return (
    <Dialog>
      <DialogTrigger
        data-testid="ask-question-trigger"
        render={
          <Button
            type="button"
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={cn('min-tap', !compact && 'w-full', className)}
          />
        }
      >
        <MessageCircleQuestion aria-hidden="true" />
        {labels.cta}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>{labels.dialogDescription}</DialogDescription>
        </DialogHeader>

        {needsSignIn ? (
          <div className="space-y-4" data-testid="ask-question-signin-prompt">
            <p className="text-sm text-muted-foreground" role="status">
              {labels.signedOutPrompt}
            </p>
            <Link
              href={signInHref}
              className="min-tap inline-flex w-full items-center justify-center rounded-[var(--radius-pill)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-sm)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {labels.signIn}
            </Link>
          </div>
        ) : success ? (
          <p
            className="text-sm text-success"
            role="status"
            data-testid="ask-question-success"
          >
            {labels.success}
          </p>
        ) : (
          <form ref={formRef} action={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ask-question-message">{labels.messageLabel}</Label>
              <Textarea
                id="ask-question-message"
                name="message"
                placeholder={labels.messagePlaceholder}
                rows={4}
                aria-required="true"
              />
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {labels.cancel}
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? labels.submitting : labels.submit}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
