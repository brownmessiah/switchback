import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Msg91Config } from './msg91-provider'
import { verifyOtpIfPhoneAuthEnabled } from './otp-availability'

/**
 * Server-side availability gate (launch-readiness 01). The verifyOTP hook
 * in lib/auth/index.ts delegates here, so the SAME predicate that decides
 * whether the sign-in UI offers the phone tab decides whether the server
 * accepts a verification — a hidden UI can never be bypassed by calling
 * the endpoint directly.
 */

const fullConfig: Msg91Config = {
  authKey: 'key_123',
  senderId: 'OUTVRS',
  templateId: 'tpl_abc',
}

const partialConfig: Msg91Config = {
  authKey: 'key_123',
  senderId: '',
  templateId: '',
}

const emptyConfig: Msg91Config = { authKey: '', senderId: '', templateId: '' }

function envFor(nodeEnv: 'development' | 'test' | 'production', config: Msg91Config) {
  return {
    NODE_ENV: nodeEnv,
    MSG91_AUTH_KEY: config.authKey || undefined,
    MSG91_SENDER_ID: config.senderId || undefined,
    MSG91_OTP_TEMPLATE_ID: config.templateId || undefined,
  }
}

describe('verifyOtpIfPhoneAuthEnabled', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses in production with no MSG91 config, without calling MSG91', async () => {
    const ok = await verifyOtpIfPhoneAuthEnabled(
      envFor('production', emptyConfig),
      emptyConfig,
      '+919876543210',
      '000000',
    )
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The case the provider alone does NOT cover: a half-configured
  // production (auth key present, sender/template missing) has a truthy
  // authKey, so the bare provider would call MSG91. The gate must refuse
  // up front — availability said the phone tab is hidden, so the server
  // must not accept what the UI does not offer.
  it('refuses in production with partial MSG91 config, without calling MSG91', async () => {
    const ok = await verifyOtpIfPhoneAuthEnabled(
      envFor('production', partialConfig),
      partialConfig,
      '+919876543210',
      '123456',
    )
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delegates to the real MSG91 verify path in fully-configured production', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'success' }), { status: 200 }),
    )
    const ok = await verifyOtpIfPhoneAuthEnabled(
      envFor('production', fullConfig),
      fullConfig,
      '+919876543210',
      '123456',
    )
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("passes the '000000' bypass through in test/E2E with no config", async () => {
    const ok = await verifyOtpIfPhoneAuthEnabled(
      envFor('test', emptyConfig),
      emptyConfig,
      '+919876543210',
      '000000',
    )
    expect(ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still rejects wrong codes in test/E2E with no config', async () => {
    const ok = await verifyOtpIfPhoneAuthEnabled(
      envFor('test', emptyConfig),
      emptyConfig,
      '+919876543210',
      '999999',
    )
    expect(ok).toBe(false)
  })
})
