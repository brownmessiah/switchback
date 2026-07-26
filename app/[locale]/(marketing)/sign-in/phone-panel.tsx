'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { INDIA_DIAL_CODE } from '@/lib/auth/phone-format'

import { OTP_LENGTH, type UsePhoneAuthFlow } from './use-phone-auth'

interface PhonePanelProps {
  flow: UsePhoneAuthFlow
}

/**
 * Presentational phone/OTP panel (launch-readiness 03). All state and
 * server calls live in `usePhoneAuthFlow` — this component only renders
 * the current step and forwards user actions, matching the split already
 * used for the email form (state in SignInForm, JSX close to the DOM).
 *
 * A separate `<form>` from the email panel, on purpose: keeps the two
 * identities' submit/keyboard behaviour independent, and keeps the
 * existing E2E selector contract intact (`input#email`'s form has no
 * OTHER submit button — tests/e2e/specs/unauthenticated/public-pages.spec.ts).
 */
export function PhonePanel({ flow }: PhonePanelProps) {
  const t = useTranslations('SignInPage.phone')

  if (flow.step === 'number') {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void flow.sendCode()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="phone-number">{t('numberLabel')}</Label>
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-[3px] focus-within:ring-ring/50">
            <span className="text-sm text-muted-foreground">{INDIA_DIAL_CODE}</span>
            <Input
              id="phone-number"
              type="tel"
              inputMode="tel"
              placeholder={t('numberPlaceholder')}
              value={flow.phoneValue}
              onChange={(e) => flow.setPhoneValue(e.target.value)}
              autoComplete="tel-national"
              autoFocus
              required
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('numberHint')}</p>
        </div>

        {flow.error && (
          <p role="alert" className="text-sm text-destructive">
            {flow.error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={flow.sending || !flow.phoneValue}>
          {flow.sending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {flow.sending ? t('sending') : t('sendCodeButton')}
        </Button>
      </form>
    )
  }

  const codeComplete = flow.code.length === OTP_LENGTH

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void flow.verifyCode()
      }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t('codeSentTo', { number: flow.sentToDisplay ?? '' })}
          </p>
          <button
            type="button"
            onClick={flow.editNumber}
            className="text-xs font-medium text-primary-strong underline-offset-4 hover:underline"
          >
            {t('editNumber')}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone-otp">{t('codeLabel')}</Label>
        <Input
          id="phone-otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={OTP_LENGTH}
          placeholder={t('codePlaceholder')}
          value={flow.code}
          onChange={(e) => flow.setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
          autoFocus
          required
        />
      </div>

      {flow.error && (
        <p role="alert" className="text-sm text-destructive">
          {flow.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={flow.verifying || !codeComplete}>
        {flow.verifying && <Loader2 className="animate-spin" aria-hidden="true" />}
        {flow.verifying ? t('verifying') : t('verifyButton')}
      </Button>

      <button
        type="button"
        onClick={() => void flow.resend()}
        disabled={flow.resendCooldown > 0}
        className="w-full text-center text-sm font-medium text-primary-strong underline-offset-4 hover:underline disabled:pointer-events-none disabled:text-muted-foreground disabled:no-underline"
      >
        {flow.resendCooldown > 0
          ? t('resendCooldown', { seconds: flow.resendCooldown })
          : t('resendButton')}
      </button>
    </form>
  )
}
