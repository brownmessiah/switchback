'use client'

/**
 * Phone/OTP sign-in + sign-up flow (launch-readiness 03).
 *
 * Phone is a full alternative identity, not a second factor: a valid OTP
 * for a known number signs that user in, and a valid OTP for an unknown
 * number creates one (lib/auth/index.ts's `signUpOnVerification`).
 * Post-auth routing reuses the exact same resolvePostAuthPath action the
 * email flow uses (launch-readiness 02), so role-based routing and a
 * sanitized `returnTo` behave identically for both identities.
 *
 * State lives here (not in the presentational PhonePanel) so the
 * sign-in page can render this alongside the email form as sibling tabs
 * without losing progress when the user switches back and forth.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { authClient } from '@/lib/auth/client'
import { formatIndianPhoneForDisplay, normalizeIndianPhoneInput } from '@/lib/auth/phone-format'

import { resolvePostAuthPath } from './actions'

export type PhoneAuthStep = 'number' | 'code'

export const OTP_LENGTH = 6
export const RESEND_COOLDOWN_SECONDS = 30

export interface UsePhoneAuthFlowOptions {
  /** Post-auth destination intent (launch-readiness 02), raw from the URL. */
  returnTo?: string | null
}

export interface UsePhoneAuthFlow {
  step: PhoneAuthStep
  phoneValue: string
  setPhoneValue: (value: string) => void
  code: string
  setCode: (value: string) => void
  error: string | null
  sending: boolean
  verifying: boolean
  resendCooldown: number
  /** The number the code was sent to, formatted for display — null until sent. */
  sentToDisplay: string | null
  sendCode: () => Promise<void>
  verifyCode: () => Promise<void>
  editNumber: () => void
  resend: () => Promise<void>
}

/** Any better-fetch/better-auth client error carries a numeric HTTP status. */
interface ClientError {
  status: number
}

function isClientError(value: unknown): value is ClientError {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { status?: unknown }).status === 'number'
  )
}

export function usePhoneAuthFlow({ returnTo }: UsePhoneAuthFlowOptions): UsePhoneAuthFlow {
  const t = useTranslations('SignInPage.phone')
  const tForm = useTranslations('SignInPage.form')

  const [step, setStep] = useState<PhoneAuthStep>('number')
  const [phoneValue, setPhoneValue] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [confirmedE164, setConfirmedE164] = useState<string | null>(null)

  useEffect(() => {
    if (resendCooldown === 0) return
    const id = setInterval(() => {
      setResendCooldown((current) => (current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [resendCooldown])

  const mapSendError = useCallback(
    (err: unknown): string => {
      if (isClientError(err) && err.status === 429) return t('sendRateLimited')
      return t('sendFailed')
    },
    [t],
  )

  const mapVerifyError = useCallback(
    (err: unknown): string => {
      // INVALID_OTP / OTP_EXPIRED / OTP_NOT_FOUND all surface as 400 — a
      // non-technical, unified message either way (issue 03 AC).
      if (isClientError(err) && err.status === 400) return t('invalidCode')
      return t('verifyFailed')
    },
    [t],
  )

  const sendCode = useCallback(async (): Promise<void> => {
    const normalized = normalizeIndianPhoneInput(phoneValue)
    if (!normalized.ok) {
      setError(t('invalidNumber'))
      return
    }

    setError(null)
    setSending(true)
    try {
      const res = await authClient.phoneNumber.sendOtp({ phoneNumber: normalized.e164 })
      if (res.error) {
        setError(mapSendError(res.error))
        return
      }
      setConfirmedE164(normalized.e164)
      setCode('')
      setStep('code')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError(tForm('networkError'))
    } finally {
      setSending(false)
    }
  }, [phoneValue, mapSendError, t, tForm])

  const verifyCode = useCallback(async (): Promise<void> => {
    if (!confirmedE164) return
    if (code.length !== OTP_LENGTH) {
      setError(t('invalidCode'))
      return
    }

    setError(null)
    setVerifying(true)
    try {
      const res = await authClient.phoneNumber.verify({ phoneNumber: confirmedE164, code })
      if (res.error) {
        setError(mapVerifyError(res.error))
        return
      }
      // Role-based routing + sanitized returnTo, identical to email
      // (launch-readiness 02) — the sanitizer runs server-side inside
      // the action regardless of what this page passes.
      const dest = await resolvePostAuthPath(returnTo ?? undefined)
      window.location.assign(dest)
    } catch {
      setError(tForm('networkError'))
    } finally {
      setVerifying(false)
    }
  }, [confirmedE164, code, mapVerifyError, t, tForm, returnTo])

  const editNumber = useCallback((): void => {
    setStep('number')
    setError(null)
    setCode('')
  }, [])

  const resend = useCallback(async (): Promise<void> => {
    if (resendCooldown > 0) return
    await sendCode()
  }, [resendCooldown, sendCode])

  return {
    step,
    phoneValue,
    setPhoneValue,
    code,
    setCode,
    error,
    sending,
    verifying,
    resendCooldown,
    sentToDisplay: confirmedE164 ? formatIndianPhoneForDisplay(confirmedE164) : null,
    sendCode,
    verifyCode,
    editNumber,
    resend,
  }
}
