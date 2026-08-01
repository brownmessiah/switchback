import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GoogleSignInButton } from '@/app/[locale]/(marketing)/sign-in/google-sign-in-button'

/**
 * Google OAuth was configured server-side (lib/auth/index.ts) but had no entry
 * point anywhere in the client — there was literally no way for a user to
 * reach it, so email + password was the only real sign-in method.
 */

const signInSocial = vi.fn(async (_opts: { provider: string; callbackURL?: string }) => ({
  error: null,
}))

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: {
      social: (opts: { provider: string; callbackURL?: string }) => signInSocial(opts),
    },
  },
}))

beforeEach(() => {
  signInSocial.mockReset()
  signInSocial.mockResolvedValue({ error: null })
})
afterEach(() => cleanup())

describe('GoogleSignInButton', () => {
  it('starts the Google OAuth flow', async () => {
    const user = userEvent.setup()
    render(<GoogleSignInButton />)

    await user.click(screen.getByRole('button', { name: /Google/i }))

    expect(signInSocial).toHaveBeenCalledTimes(1)
    expect(signInSocial.mock.calls[0]![0].provider).toBe('google')
  })

  it('carries the post-auth destination through the round trip', async () => {
    // OAuth leaves the app entirely, so the intended destination has to survive
    // as a callbackURL or the vendor funnel dead-ends exactly as it did before.
    const user = userEvent.setup()
    render(<GoogleSignInButton nextPath="/vendor/onboarding" />)

    await user.click(screen.getByRole('button', { name: /Google/i }))

    // Encoded in the query string, so decode before asserting.
    const callbackURL = signInSocial.mock.calls[0]![0].callbackURL ?? ''
    expect(decodeURIComponent(callbackURL)).toContain('/vendor/onboarding')
  })

  it('surfaces a provider error instead of failing silently', async () => {
    const user = userEvent.setup()
    signInSocial.mockResolvedValue({ error: { message: 'Google is unavailable.' } } as never)
    render(<GoogleSignInButton />)

    await user.click(screen.getByRole('button', { name: /Google/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i)
  })

  it('disables itself while the redirect is in flight', async () => {
    const user = userEvent.setup()
    let release: (() => void) | undefined
    signInSocial.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ error: null })
        }),
    )
    render(<GoogleSignInButton />)

    const button = screen.getByRole('button', { name: /Google/i })
    await user.click(button)

    expect(button).toBeDisabled()
    release?.()
  })
})
