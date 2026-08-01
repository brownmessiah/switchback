import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PhoneOtpForm } from '@/app/[locale]/(marketing)/sign-in/phone-otp-form'

/**
 * Phone + OTP sign-in / signup.
 *
 * The MSG91 provider and the better-auth phoneNumber plugin were both fully
 * wired, but nothing in the client ever called them — there was no way for a
 * user to reach the flow at all. ADR-0007 defines Tier 1 as "MSG91 OTP
 * confirmed at signup", which was true of nobody.
 *
 * Every send costs money, so the UI's job is as much about NOT sending as
 * about sending: validate before the request, disable while in flight, and
 * make the resend deliberate.
 */

const sendOtp = vi.fn(async (_o: { phoneNumber: string }) => ({ error: null as unknown }))
const verifyPhone = vi.fn(
  async (_o: { phoneNumber: string; code: string }) => ({ error: null as unknown }),
)
const resolvePostAuthPath = vi.fn(async (_next?: string) => '/dashboard')

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    phoneNumber: {
      sendOtp: (o: { phoneNumber: string }) => sendOtp(o),
      verify: (o: { phoneNumber: string; code: string }) => verifyPhone(o),
    },
  },
}))

vi.mock('@/app/[locale]/(marketing)/sign-in/actions', () => ({
  resolvePostAuthPath: (next?: string) => resolvePostAuthPath(next),
}))

beforeEach(() => {
  sendOtp.mockReset()
  sendOtp.mockResolvedValue({ error: null })
  verifyPhone.mockReset()
  verifyPhone.mockResolvedValue({ error: null })
  resolvePostAuthPath.mockReset()
  resolvePostAuthPath.mockResolvedValue('/dashboard')
})
afterEach(() => cleanup())

async function enterPhoneAndSend(user: ReturnType<typeof userEvent.setup>, value = '+919876543210') {
  await user.type(screen.getByLabelText(/phone/i), value)
  await user.click(screen.getByRole('button', { name: /send code/i }))
}

describe('PhoneOtpForm — requesting a code', () => {
  it('sends an OTP to the number entered', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)

    await enterPhoneAndSend(user)

    expect(sendOtp).toHaveBeenCalledTimes(1)
    expect(sendOtp.mock.calls[0]![0].phoneNumber).toBe('+919876543210')
  })

  it('refuses to spend an SMS on a number with no country code', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)

    await user.type(screen.getByLabelText(/phone/i), '9876543210')
    await user.click(screen.getByRole('button', { name: /send code/i }))

    expect(sendOtp).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/country code|\+91/i)
  })

  it('moves to the code step once the code is on its way', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)

    await enterPhoneAndSend(user)

    expect(await screen.findByLabelText(/code/i)).toBeInTheDocument()
  })

  it('shows the number the code went to, so a typo is visible', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)

    await enterPhoneAndSend(user)

    expect(await screen.findByText(/\+919876543210/)).toBeInTheDocument()
  })

  it('surfaces a send failure rather than silently stalling', async () => {
    const user = userEvent.setup()
    sendOtp.mockResolvedValue({ error: { message: 'Too many requests.' } })
    render(<PhoneOtpForm />)

    await enterPhoneAndSend(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many requests/i)
  })

  it('stays on the phone step when sending failed', async () => {
    const user = userEvent.setup()
    sendOtp.mockResolvedValue({ error: { message: 'Too many requests.' } })
    render(<PhoneOtpForm />)

    await enterPhoneAndSend(user)

    expect(screen.queryByLabelText(/code/i)).not.toBeInTheDocument()
  })
})

describe('PhoneOtpForm — entering the code', () => {
  it('verifies the code against the number it was sent to', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)
    await enterPhoneAndSend(user)

    await user.type(await screen.findByLabelText(/code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify/i }))

    expect(verifyPhone).toHaveBeenCalledTimes(1)
    expect(verifyPhone.mock.calls[0]![0]).toMatchObject({
      phoneNumber: '+919876543210',
      code: '123456',
    })
  })

  it('does not submit a half-typed code', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)
    await enterPhoneAndSend(user)

    await user.type(await screen.findByLabelText(/code/i), '123')

    expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled()
  })

  it('reports a wrong code without losing the step', async () => {
    const user = userEvent.setup()
    verifyPhone.mockResolvedValue({ error: { message: 'Invalid OTP' } })
    render(<PhoneOtpForm />)
    await enterPhoneAndSend(user)

    await user.type(await screen.findByLabelText(/code/i), '000000')
    await user.click(screen.getByRole('button', { name: /verify/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i)
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument()
  })

  it('routes to the role-appropriate destination once verified', async () => {
    const user = userEvent.setup()
    resolvePostAuthPath.mockResolvedValue('/vendor/onboarding')
    render(<PhoneOtpForm nextPath="/vendor/onboarding" />)
    await enterPhoneAndSend(user)

    await user.type(await screen.findByLabelText(/code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify/i }))

    await waitFor(() => expect(resolvePostAuthPath).toHaveBeenCalledWith('/vendor/onboarding'))
  })

  it('lets the user go back and fix a mistyped number', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)
    await enterPhoneAndSend(user)

    await user.click(await screen.findByRole('button', { name: /change number/i }))

    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
  })
})

describe('PhoneOtpForm — resending', () => {
  it('does not allow an immediate resend, so a click cannot burn SMS credit', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)
    await enterPhoneAndSend(user)

    expect(await screen.findByRole('button', { name: /resend/i })).toBeDisabled()
  })

  it('counts down to when a resend becomes available', async () => {
    const user = userEvent.setup()
    render(<PhoneOtpForm />)
    await enterPhoneAndSend(user)

    expect(await screen.findByRole('button', { name: /resend/i })).toHaveTextContent(/\d+\s*s/i)
  })
})
