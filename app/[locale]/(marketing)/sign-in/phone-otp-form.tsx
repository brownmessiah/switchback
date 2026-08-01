'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth/client'
import { isValidPhoneNumber } from '@/lib/auth/phone-identity'

import { resolvePostAuthPath } from './actions'

interface PhoneOtpFormProps {
  /** Post-auth destination, validated server-side by resolvePostAuthPath. */
  nextPath?: string
}

/** Seconds before a resend is allowed. Every send costs an SMS. */
const RESEND_COOLDOWN_SECONDS = 30

const OTP_LENGTH = 6

/**
 * Phone + OTP sign-in and signup (MSG91, ADR-0007 Tier 1).
 *
 * The provider and the better-auth plugin were both fully wired, but nothing
 * in the client ever called them, so the flow was unreachable — ADR-0007's
 * "MSG91 OTP confirmed at signup" was true of nobody.
 *
 * Every send costs money, so this component is as much about NOT sending:
 * the number is validated before the request (MSG91 cannot route a number
 * without a country code, so that send would be pure waste), the button is
 * disabled in flight, and resend sits behind a visible cooldown.
 */
export function PhoneOtpForm({ nextPath }: PhoneOtpFormProps = {}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const requestCode = useCallback(async () => {
    setError('')

    if (!isValidPhoneNumber(phone)) {
      setError('Enter your number with a country code, e.g. +91 98765 43210.')
      return
    }

    setLoading(true)
    try {
      const result = await authClient.phoneNumber.sendOtp({ phoneNumber: phone })
      if (result?.error) {
        setError(
          (result.error as { message?: string }).message ??
            'Could not send the code. Please try again.',
        )
        return
      }
      setStep('code')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError('Could not send the code. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }, [phone])

  async function handleVerify() {
    setError('')
    setLoading(true)
    try {
      const result = await authClient.phoneNumber.verify({
        phoneNumber: phone,
        code,
      })
      if (result?.error) {
        setError(
          (result.error as { message?: string }).message ??
            'That code did not work. Check it and try again.',
        )
        return
      }

      // Same role-aware routing as the email flow; `next` is re-validated
      // server-side against the allowlist.
      const destination = await resolvePostAuthPath(nextPath)
      // Hard navigation: the post-auth session UI lives in the persistent root
      // layout, which a soft nav does not re-render.
      window.location.assign(destination)
    } catch {
      setError('Could not verify the code. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'phone') {
    return (
      <div className="space-y-3">
        <div className="space-y-[var(--space-field)]">
          <Label htmlFor="phone-number">Phone number</Label>
          <Input
            id="phone-number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            We&apos;ll text you a {OTP_LENGTH}-digit code. Standard rates apply.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="button" className="w-full" disabled={loading} onClick={requestCode}>
          {loading ? 'Sending…' : 'Send code'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-[var(--space-field)]">
        <Label htmlFor="otp-code">Verification code</Label>
        <Input
          id="otp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        />
        <p className="text-xs text-muted-foreground">
          Sent to <span className="font-medium text-foreground">{phone}</span>
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={loading || code.length < OTP_LENGTH}
        onClick={handleVerify}
      >
        {loading ? 'Verifying…' : 'Verify and continue'}
      </Button>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setStep('phone')
            setCode('')
            setError('')
          }}
        >
          Change number
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading || cooldown > 0}
          onClick={requestCode}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </Button>
      </div>
    </div>
  )
}
