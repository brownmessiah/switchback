'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { authClient } from '@/lib/auth/client'
import { getHeroImage } from '@/lib/images'

import { resolvePostAuthPath } from './actions'

type Mode = 'signin' | 'signup'
type Step = 'email' | 'credentials'

export function SignInForm() {
  const router = useRouter()
  const t = useTranslations('SignInPage.form')
  const tp = useTranslations('SignInPage.trustPanel')

  const [mode, setMode] = useState<Mode>('signin')
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // STEP 1 → STEP 2 is pure client-side progressive disclosure. There is NO
  // server "does this email exist" check (that would be an email-enumeration
  // risk); the collected email is simply carried into the real auth call.
  function handleContinue() {
    if (!email) return
    setError('')
    setStep('credentials')
  }

  function backToEmail() {
    setError('')
    setStep('email')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res =
        mode === 'signin'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({
              email,
              password,
              name: name || email.split('@')[0],
            })

      if (res.error) {
        setError(
          res.error.message ??
            (mode === 'signin' ? t('signInError') : t('signUpError')),
        )
        return
      }

      // Route to the role-appropriate dashboard (admin / vendor / customer)
      // rather than always the marketing home (ADR-0006 role resolution).
      const dest = await resolvePostAuthPath()
      router.push(dest)
      router.refresh()
    } catch {
      setError(t('networkError'))
    } finally {
      setLoading(false)
    }
  }

  // Each chip pairs a semantic-status colour WITH a lucide icon, so trust is
  // never conveyed by colour alone (DESIGN.md §1.3, WCAG 1.4.1). Real Outvers
  // value props (CONTEXT.md verbatim: Vendor, Refund, Partial pay).
  const trustChips = [
    { key: 'verified', Icon: ShieldCheck, label: tp('chipVerified'), variant: 'success' as const },
    { key: 'refund', Icon: ReceiptText, label: tp('chipRefund'), variant: 'success' as const },
    { key: 'partialPay', Icon: CreditCard, label: tp('chipPartialPay'), variant: 'info' as const },
  ]

  return (
    <div className="grid w-full max-w-5xl overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-1 shadow-[var(--shadow-lg)] md:grid-cols-2">
      {/* ── Trust Wall panel: warm adventure visual + 3 trust chips ─────────
          On mobile this collapses above the form as a condensed band. */}
      <section className="relative order-first flex min-h-[180px] flex-col justify-end overflow-hidden p-6 md:order-none md:min-h-[34rem] md:p-8">
        <Image
          src={getHeroImage()}
          alt=""
          role="presentation"
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
        {/* Scrim keeps the heading + chips AA-legible over imagery. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />

        <div className="relative z-10 space-y-4">
          <h2 className="font-heading text-h2 font-bold text-white">
            {tp('heading')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {trustChips.map(({ key, Icon, label, variant }) => (
              <li key={key}>
                <Badge variant={variant} className="h-auto py-1 text-xs">
                  <Icon aria-hidden="true" />
                  {label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Lean email-first form (two-step progressive disclosure) ────────── */}
      <section className="flex flex-col justify-center gap-6 p-6 md:p-10">
        <div className="space-y-1.5">
          <h1 className="font-heading text-h2 font-bold text-foreground">
            {mode === 'signin' ? t('signInTitle') : t('signUpTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === 'email'
              ? t('step1Hint')
              : mode === 'signin'
                ? t('signInSubtitle')
                : t('signUpSubtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* The email field (stable input#email[type=email]) is always
              rendered — its value feeds the real auth call. On step 2 it stays
              visible but read-only, with an inline "edit" affordance back to
              step 1. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              {step === 'credentials' && (
                <button
                  type="button"
                  onClick={backToEmail}
                  className="text-xs font-medium text-primary-strong underline-offset-4 hover:underline"
                >
                  {t('editEmail')}
                </button>
              )}
            </div>
            <Input
              id="email"
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              readOnly={step === 'credentials'}
              autoFocus={step === 'email'}
              className={step === 'credentials' ? 'bg-muted/40' : undefined}
            />
          </div>

          {step === 'credentials' && (
            <>
              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="name">{t('nameLabel')}</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder={t('namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t('passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {step === 'email' ? (
            // Always rendered at full brand crimson — NOT disabled-on-empty,
            // which made the primary auth CTA read as a washed-out/disabled pale
            // pink on first paint. handleContinue still guards the empty case.
            <Button
              type="button"
              data-testid="continue-step1"
              className="w-full"
              onClick={handleContinue}
            >
              {t('continue')}
            </Button>
          ) : (
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !email || password.length < 8}
            >
              {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
              {loading
                ? t('loading')
                : mode === 'signin'
                  ? t('signInButton')
                  : t('signUpButton')}
            </Button>
          )}

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signin' ? (
              <>
                {t('newHere')}{' '}
                <button
                  type="button"
                  className="font-medium text-primary-strong underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode('signup')
                    setError('')
                  }}
                >
                  {t('createAccount')}
                </button>
              </>
            ) : (
              <>
                {t('alreadyHaveAccount')}{' '}
                <button
                  type="button"
                  className="font-medium text-primary-strong underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode('signin')
                    setError('')
                  }}
                >
                  {t('signInLink')}
                </button>
              </>
            )}
          </p>
        </form>

        <Separator />

        {/* Secondary role-aware route → real /vendor/onboarding (Direction C
            routing folded in as a quiet secondary link, per SELECTION.md). */}
        <p className="text-center text-sm text-muted-foreground">
          {t('vendorPrompt')}{' '}
          <Link
            href="/vendor/onboarding"
            className="inline-flex items-center gap-1 font-medium text-primary-strong underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5 rotate-180" aria-hidden="true" />
            {t('vendorCta')}
          </Link>
        </p>
      </section>
    </div>
  )
}
