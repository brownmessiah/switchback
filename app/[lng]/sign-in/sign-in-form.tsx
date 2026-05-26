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

type Mode = 'signin' | 'signup'

interface SignInFormProps {
  lng: string
}

export function SignInForm({ lng }: SignInFormProps) {
  const router = useRouter()
  const prefix = lng === 'en' ? '' : `/${lng}`

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await authClient.signIn.email({
        email,
        password,
      })

      if (res.error) {
        setError(res.error.message ?? 'Sign in failed. Check your credentials.')
        return
      }

      router.push(`${prefix}/`)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await authClient.signUp.email({
        email,
        password,
        name: name || email.split('@')[0],
      })

      if (res.error) {
        setError(res.error.message ?? 'Sign up failed. Try a different email.')
        return
      }

      router.push(`${prefix}/`)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {mode === 'signin' ? 'Sign in to Outvers' : 'Create an account'}
        </CardTitle>
        <CardDescription>
          {mode === 'signin'
            ? 'Enter your email to continue'
            : 'Sign up to book adventures'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
          className="space-y-4"
        >
          {mode === 'signup' && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={mode === 'signin'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !email || password.length < 8}
          >
            {loading
              ? 'Please wait...'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'}
          </Button>

          <Separator />

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signin' ? (
              <>
                New here?{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => { setMode('signup'); setError('') }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => { setMode('signin'); setError('') }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
