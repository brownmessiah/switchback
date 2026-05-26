'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { authClient } from '@/lib/auth/client'

type Step = 'phone' | 'otp'

interface SignInFormProps {
  lng: string
}

export function SignInForm({ lng }: SignInFormProps) {
  const router = useRouter()
  const prefix = lng === 'en' ? '' : `/${lng}`

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const fullPhone = phone.startsWith('+') ? phone : `+91${phone}`

    try {
      const res = await authClient.phoneNumber.sendOtp({
        phoneNumber: fullPhone,
      })

      if (res.error) {
        setError(res.error.message ?? 'Failed to send OTP. Try again.')
        return
      }

      setStep('otp')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const fullPhone = phone.startsWith('+') ? phone : `+91${phone}`

    try {
      const res = await authClient.signIn.phoneNumber({
        phoneNumber: fullPhone,
        password: otp,
      })

      if (res.error) {
        setError(res.error.message ?? 'Invalid OTP. Please try again.')
        return
      }

      router.push(`${prefix}/`)
      router.refresh()
    } catch {
      setError('Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Sign in to Outvers</CardTitle>
        <CardDescription>
          {step === 'phone'
            ? 'Enter your phone number to get started'
            : `We sent a code to +91${phone}`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {step === 'phone' ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <div className="flex gap-2">
                <span className="flex items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                  +91
                </span>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  required
                  minLength={10}
                  maxLength={10}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading || phone.length !== 10}>
              {loading ? 'Sending...' : 'Send OTP'}
            </Button>

            <Separator />

            <p className="text-center text-xs text-muted-foreground">
              In demo mode, use code <strong>000000</strong> to verify.
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                minLength={6}
                maxLength={6}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading || otp.length !== 6}>
              {loading ? 'Verifying...' : 'Verify & sign in'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep('phone')
                setOtp('')
                setError('')
              }}
            >
              Change number
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
