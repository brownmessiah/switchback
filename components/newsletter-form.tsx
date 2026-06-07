'use client'

import { useId, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, TriangleAlert } from 'lucide-react'

import { subscribeNewsletterAction } from '@/lib/newsletter/actions'

/**
 * Footer newsletter capture form (Issue 01). A client component that posts to
 * the `subscribeNewsletterAction` Server Action, which persists the email to the
 * standalone `newsletter_subscribers` marketing-capture table (de-duped on a
 * normalized, unique email).
 *
 * Client-side validation mirrors the server's Zod email check for fast inline
 * feedback, but the server re-validates at the boundary — the client check is a
 * convenience, never the trust boundary. No business logic lives here.
 *
 * States are surfaced honestly (never a silent no-op):
 *   - idle / editing → the form,
 *   - submitting → disabled controls + "subscribing…" label,
 *   - success OR already-subscribed → a friendly confirmation panel,
 *   - invalid → an inline field error,
 *   - error → a submit-level error alert.
 *
 * `already-subscribed` is treated as a graceful confirmation, never an error —
 * the visitor's intent is already captured, so we never make them feel rejected.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function NewsletterForm() {
  const t = useTranslations('Nav.footer.newsletter')

  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  const emailId = useId()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFieldError(null)
    setSubmitError(null)

    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setFieldError(t('errorInvalid'))
      return
    }

    startTransition(async () => {
      const result = await subscribeNewsletterAction(trimmed, { source: 'footer' })
      switch (result.status) {
        case 'success':
          setSuccessMessage(t('success'))
          setSucceeded(true)
          break
        case 'already-subscribed':
          // Captured intent already exists — confirm gracefully, never as an error.
          setSuccessMessage(t('alreadySubscribed'))
          setSucceeded(true)
          break
        case 'invalid':
          setFieldError(t('errorInvalid'))
          break
        case 'error':
          setSubmitError(t('errorGeneric'))
          break
      }
    })
  }

  if (succeeded) {
    return (
      <div
        className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-success/30 bg-success-subtle p-4 shadow-[var(--shadow-sm)]"
        role="status"
        data-testid="newsletter-success"
      >
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="text-sm text-foreground">{successMessage}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-2"
      data-testid="newsletter-form"
      aria-describedby={`${emailId}-desc`}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('heading')}
      </h3>
      <p id={`${emailId}-desc`} className="text-sm text-muted-foreground">
        {t('description')}
      </p>

      <label htmlFor={emailId} className="sr-only">
        {t('label')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t('placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label={t('label')}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${emailId}-error` : undefined}
          data-testid="newsletter-email"
          className="min-tap h-11 flex-1 rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive"
        />
        <button
          type="submit"
          disabled={isPending}
          data-testid="newsletter-submit"
          className="min-tap inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary-strong focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? t('submitting') : t('button')}
        </button>
      </div>

      {fieldError && (
        <p
          id={`${emailId}-error`}
          className="text-xs text-destructive"
          role="alert"
          data-testid="newsletter-error"
        >
          {fieldError}
        </p>
      )}

      {submitError && (
        <div
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2"
          role="alert"
          data-testid="newsletter-error"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-xs text-destructive">{submitError}</p>
        </div>
      )}
    </form>
  )
}
