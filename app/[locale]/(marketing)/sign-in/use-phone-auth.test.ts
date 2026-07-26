import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mocks -----------------------------------------------------------------
// Scoped translation stub: returns the bare key so assertions can pin the
// exact i18n key surfaced, without coupling to translated copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const sendOtp = vi.fn()
const verify = vi.fn()
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    phoneNumber: {
      sendOtp: (...args: unknown[]) => sendOtp(...args),
      verify: (...args: unknown[]) => verify(...args),
    },
  },
}))

const resolvePostAuthPath = vi.fn()
vi.mock('./actions', () => ({
  resolvePostAuthPath: (...args: unknown[]) => resolvePostAuthPath(...args),
}))

import { usePhoneAuthFlow } from './use-phone-auth'

function stubLocationAssign() {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  })
  return assign
}

describe('usePhoneAuthFlow', () => {
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    sendOtp.mockReset()
    verify.mockReset()
    resolvePostAuthPath.mockReset()
    assign = stubLocationAssign()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts on the number step with no error', () => {
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))
    expect(result.current.step).toBe('number')
    expect(result.current.error).toBeNull()
  })

  it('rejects an invalid number without calling the server', async () => {
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))

    act(() => result.current.setPhoneValue('123'))
    await act(async () => {
      await result.current.sendCode()
    })

    expect(sendOtp).not.toHaveBeenCalled()
    expect(result.current.step).toBe('number')
    expect(result.current.error).toBe('invalidNumber')
  })

  it('sends the canonical E.164 number and advances to the code step', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))

    act(() => result.current.setPhoneValue('98765 43210'))
    await act(async () => {
      await result.current.sendCode()
    })

    expect(sendOtp).toHaveBeenCalledWith({ phoneNumber: '+919876543210' })
    expect(result.current.step).toBe('code')
    expect(result.current.sentToDisplay).toBe('+91 98765 43210')
    expect(result.current.error).toBeNull()
  })

  it('does not advance to the code step when the send fails', async () => {
    sendOtp.mockResolvedValue({
      data: null,
      error: { status: 502, code: 'OTP_SEND_UPSTREAM_ERROR', message: 'nope' },
    })
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))

    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    expect(result.current.step).toBe('number')
    expect(result.current.error).toBe('sendFailed')
  })

  it('surfaces a distinct message when the send is rate-limited', async () => {
    sendOtp.mockResolvedValue({ data: null, error: { status: 429 } })
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))

    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    expect(result.current.error).toBe('sendRateLimited')
  })

  it('rejects an incomplete code without calling the server', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))
    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    act(() => result.current.setCode('123'))
    await act(async () => {
      await result.current.verifyCode()
    })

    expect(verify).not.toHaveBeenCalled()
    expect(result.current.error).toBe('invalidCode')
  })

  it('verifies a complete code and routes to the resolved post-auth path', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    verify.mockResolvedValue({ data: { status: true, token: 't', user: {} }, error: null })
    resolvePostAuthPath.mockResolvedValue('/vendor/onboarding')

    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: '/vendor/onboarding' }))
    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    act(() => result.current.setCode('000000'))
    await act(async () => {
      await result.current.verifyCode()
    })

    expect(verify).toHaveBeenCalledWith({ phoneNumber: '+919876543210', code: '000000' })
    expect(resolvePostAuthPath).toHaveBeenCalledWith('/vendor/onboarding')
    expect(assign).toHaveBeenCalledWith('/vendor/onboarding')
  })

  it('shows a clear, non-technical error for an invalid OTP and allows retry', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    verify.mockResolvedValue({ data: null, error: { status: 400, code: 'INVALID_OTP' } })

    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))
    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    act(() => result.current.setCode('999999'))
    await act(async () => {
      await result.current.verifyCode()
    })

    expect(result.current.error).toBe('invalidCode')
    // Retry allowed: still on the code step, not bounced back to number entry.
    expect(result.current.step).toBe('code')
    expect(assign).not.toHaveBeenCalled()
  })

  it('lets the number be edited without restarting the flow', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))
    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    act(() => result.current.editNumber())

    expect(result.current.step).toBe('number')
    // The typed number is preserved for editing, not cleared.
    expect(result.current.phoneValue).toBe('9876543210')
  })

  it('disables resend until the cooldown elapses, then allows it', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))
    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    expect(result.current.resendCooldown).toBeGreaterThan(0)
    const cooldownAfterSend = result.current.resendCooldown

    await act(async () => {
      await result.current.resend()
    })
    // Still cooling down — resend() is a no-op, must not call the server again.
    expect(sendOtp).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime((cooldownAfterSend + 1) * 1000)
    })
    expect(result.current.resendCooldown).toBe(0)

    await act(async () => {
      await result.current.resend()
    })
    expect(sendOtp).toHaveBeenCalledTimes(2)
  })

  it('surfaces a network error on a rejected send call', async () => {
    sendOtp.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => usePhoneAuthFlow({ returnTo: null }))
    act(() => result.current.setPhoneValue('9876543210'))
    await act(async () => {
      await result.current.sendCode()
    })

    expect(result.current.step).toBe('number')
    expect(result.current.error).toBe('networkError')
  })
})
