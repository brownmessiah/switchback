import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Scoped translation stub: returns the bare key, with interpolation values
// appended, so assertions can pin exact keys without coupling to copy.
vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(' ')}` : key,
}))

const sendOtp = vi.fn()
const verify = vi.fn()
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: { email: vi.fn(async () => ({ data: null, error: null })) },
    signUp: { email: vi.fn(async () => ({ data: null, error: null })) },
    phoneNumber: {
      sendOtp: (...args: unknown[]) => sendOtp(...args),
      verify: (...args: unknown[]) => verify(...args),
    },
  },
}))

vi.mock('./actions', () => ({
  resolvePostAuthPath: vi.fn(async () => '/dashboard'),
}))

import { SignInForm } from './sign-in-form'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  sendOtp.mockReset()
  verify.mockReset()
})

describe('SignInForm — phone/email tab wiring (launch-readiness 03)', () => {
  it('renders email-only, with no tab affordance, when phone auth is disabled', () => {
    render(<SignInForm phoneAuthEnabled={false} />)

    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByLabelText('emailLabel')).toBeVisible()
  })

  it('offers email and phone as sibling tabs when phone auth is enabled, email active by default', () => {
    render(<SignInForm phoneAuthEnabled />)

    expect(screen.getByRole('tab', { name: 'email' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'phone' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'email' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('emailLabel')).toBeVisible()
  })

  it('switches to the phone panel on tab click', async () => {
    const user = userEvent.setup()
    render(<SignInForm phoneAuthEnabled />)

    await user.click(screen.getByRole('tab', { name: 'phone' }))
    expect(screen.getByLabelText('numberLabel')).toBeVisible()
  })

  it('does not lose the typed email when switching to phone and back', async () => {
    const user = userEvent.setup()
    const { container } = render(<SignInForm phoneAuthEnabled />)

    await user.type(screen.getByLabelText('emailLabel'), 'traveller@example.com')
    await user.click(screen.getByRole('tab', { name: 'phone' }))
    await user.click(screen.getByRole('tab', { name: 'email' }))

    const emailInput = container.querySelector<HTMLInputElement>('input#email')
    expect(emailInput?.value).toBe('traveller@example.com')
  })

  it('does not lose the typed phone number when switching to email and back', async () => {
    const user = userEvent.setup()
    const { container } = render(<SignInForm phoneAuthEnabled />)

    await user.click(screen.getByRole('tab', { name: 'phone' }))
    await user.type(screen.getByLabelText('numberLabel'), '9876543210')
    await user.click(screen.getByRole('tab', { name: 'email' }))
    await user.click(screen.getByRole('tab', { name: 'phone' }))

    const phoneInput = container.querySelector<HTMLInputElement>('#phone-number')
    expect(phoneInput?.value).toBe('9876543210')
  })

  it('keeps the email form as the only form with input#email and no stray submit buttons at step 1', () => {
    const { container } = render(<SignInForm phoneAuthEnabled />)

    const emailInputs = container.querySelectorAll('input#email[type="email"]')
    expect(emailInputs).toHaveLength(1)

    const emailForm = emailInputs[0]?.closest('form')
    expect(emailForm?.querySelectorAll('button[type="submit"]')).toHaveLength(0)
  })
})
