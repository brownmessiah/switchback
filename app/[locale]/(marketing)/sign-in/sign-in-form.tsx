'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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

export function SignInForm() {
  const router = useRouter()
  const t = useTranslations('SignInPage.form')

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
        setError(res.error.message ?? t('signInError'))
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError(t('networkError'))
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
        setError(res.error.message ?? t('signUpError'))
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError(t('networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {mode === 'signin' ? t('signInTitle') : t('signUpTitle')}
        </CardTitle>
        <CardDescription>
          {mode === 'signin'
            ? t('signInSubtitle')
            : t('signUpSubtitle')}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
          className="space-y-4"
        >
          {mode === 'signup' && (
            <div className="space-y-2">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input
                id="name"
                type="text"
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={mode === 'signin'}
            />
          </div>

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
              ? t('loading')
              : mode === 'signin'
                ? t('signInButton')
                : t('signUpButton')}
          </Button>

          <Separator />

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signin' ? (
              <>
                {t('newHere')}{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => { setMode('signup'); setError('') }}
                >
                  {t('createAccount')}
                </button>
              </>
            ) : (
              <>
                {t('alreadyHaveAccount')}{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => { setMode('signin'); setError('') }}
                >
                  {t('signInLink')}
                </button>
              </>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
