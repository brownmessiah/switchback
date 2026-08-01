'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'

interface GoogleSignInButtonProps {
  /**
   * Where to land after authenticating. OAuth leaves the app entirely, so this
   * has to survive the round trip as a `callbackURL` — otherwise a visitor who
   * came from the vendor funnel returns to the customer dashboard, which is
   * exactly the dead-end the `next` plumbing exists to fix.
   */
  nextPath?: string
}

/**
 * Google OAuth entry point.
 *
 * The provider was configured server-side (lib/auth/index.ts) but had no
 * button anywhere in the client, so email + password was in practice the only
 * way in. Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to be populated —
 * with empty credentials better-auth rejects the flow and the error surfaces
 * here rather than failing silently.
 */
export function GoogleSignInButton({ nextPath }: GoogleSignInButtonProps = {}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleClick() {
    setError('')
    setLoading(true)
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        // Round-trips through Google and back. The value is re-validated
        // server-side against the same allowlist as the email flow.
        callbackURL: nextPath
          ? `/api/post-signin?next=${encodeURIComponent(nextPath)}`
          : '/api/post-signin',
      })
      if (result?.error) {
        setError(result.error.message ?? 'Could not continue with Google.')
      }
    } catch {
      setError('Could not continue with Google. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading}
        onClick={handleClick}
      >
        <GoogleMark />
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </Button>
      {error && (
        <p className="text-center text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Google's mark, inlined so the button needs no external asset. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}
