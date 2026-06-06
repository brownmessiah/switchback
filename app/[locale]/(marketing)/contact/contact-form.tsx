'use client'

import { useId, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, TriangleAlert } from 'lucide-react'

import { submitContactAction } from './actions'

/**
 * Contact lead form (Issue 07). A client component that posts to the
 * `submitContactAction` Server Action, which creates a real `support_ticket`
 * under the dedicated guest-contact system User.
 *
 * Validation mirrors the server's Zod schema (lib/support/contact.ts) for
 * fast inline feedback, but the server re-validates at the boundary — the
 * client check is a convenience, never the trust boundary.
 *
 * Three states are surfaced honestly (never a silent no-op):
 *   - idle / editing → the form,
 *   - submitting → disabled controls,
 *   - success → a confirmation panel, or a submit-level error alert.
 */

type FieldErrors = Partial<Record<'name' | 'email' | 'subject' | 'message', string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ContactForm() {
  const t = useTranslations('ContactPage.form')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState(false)
  const [isPending, startTransition] = useTransition()

  const nameId = useId()
  const emailId = useId()
  const subjectId = useId()
  const messageId = useId()

  function validate(): FieldErrors {
    const errs: FieldErrors = {}
    if (!name.trim()) errs.name = t('errors.name')
    if (!EMAIL_RE.test(email.trim())) errs.email = t('errors.email')
    if (!subject.trim()) errs.subject = t('errors.subject')
    if (message.trim().length < 10) errs.message = t('errors.message')
    return errs
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitError(null)

    const errs = validate()
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    startTransition(async () => {
      const result = await submitContactAction({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      })
      if (result.ok) {
        setSucceeded(true)
      } else {
        setSubmitError(result.error)
      }
    })
  }

  if (succeeded) {
    return (
      <div
        className="flex items-start gap-3 rounded-[var(--radius-card)] border border-success/30 bg-success-subtle p-5 shadow-[var(--shadow-sm)]"
        role="status"
        data-testid="contact-success"
      >
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-base font-medium text-foreground">{t('successTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('successBody')}</p>
        </div>
      </div>
    )
  }

  const inputClass =
    'h-10 rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive'

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      data-testid="contact-form"
    >
      {submitError && (
        <div
          className="flex items-start gap-3 rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-4 py-3"
          role="alert"
          data-testid="contact-submit-error"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm text-destructive">{submitError}</p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-[var(--space-field)]">
          <label htmlFor={nameId} className="text-sm font-medium text-foreground">
            {t('nameLabel')}
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
            className={inputClass}
          />
          {fieldErrors.name && (
            <p id={`${nameId}-error`} className="text-xs text-destructive" role="alert">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-[var(--space-field)]">
          <label htmlFor={emailId} className="text-sm font-medium text-foreground">
            {t('emailLabel')}
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
            className={inputClass}
          />
          {fieldErrors.email && (
            <p id={`${emailId}-error`} className="text-xs text-destructive" role="alert">
              {fieldErrors.email}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-[var(--space-field)]">
        <label htmlFor={subjectId} className="text-sm font-medium text-foreground">
          {t('subjectLabel')}
        </label>
        <input
          id={subjectId}
          name="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-invalid={fieldErrors.subject ? true : undefined}
          aria-describedby={fieldErrors.subject ? `${subjectId}-error` : undefined}
          className={inputClass}
        />
        {fieldErrors.subject && (
          <p id={`${subjectId}-error`} className="text-xs text-destructive" role="alert">
            {fieldErrors.subject}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-[var(--space-field)]">
        <label htmlFor={messageId} className="text-sm font-medium text-foreground">
          {t('messageLabel')}
        </label>
        <textarea
          id={messageId}
          name="message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={fieldErrors.message ? `${messageId}-error` : undefined}
          className="rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive"
        />
        {fieldErrors.message && (
          <p id={`${messageId}-error`} className="text-xs text-destructive" role="alert">
            {fieldErrors.message}
          </p>
        )}
      </div>

      <div>
        <button
          type="submit"
          disabled={isPending}
          data-testid="contact-submit"
          className="min-tap inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:bg-primary-strong focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  )
}
