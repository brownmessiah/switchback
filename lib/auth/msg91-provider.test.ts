import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  sendOtpViaMsg91,
  verifyOtpViaMsg91,
  type Msg91Config,
} from './msg91-provider'

const config: Msg91Config = {
  authKey: 'test-auth-key',
  senderId: 'OUTVRS',
  templateId: 'tpl_abc123',
}

describe('sendOtpViaMsg91', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to the MSG91 send-otp endpoint with auth header + phone payload', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'success', request_id: 'req_1' }), {
        status: 200,
      }),
    )

    const result = await sendOtpViaMsg91(config, '+919876543210')

    expect(result).toEqual({ success: true, requestId: 'req_1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/control\.msg91\.com.*\/v5\/otp/)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['authkey']).toBe(
      'test-auth-key',
    )
    expect(JSON.parse(init.body as string)).toMatchObject({
      mobile: '919876543210', // leading + stripped per MSG91 contract
      sender: 'OUTVRS',
      template_id: 'tpl_abc123',
    })
  })

  it('reports rate_limited when MSG91 returns 429', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Too many requests', { status: 429 }))

    const result = await sendOtpViaMsg91(config, '+919876543210')

    expect(result).toEqual({ success: false, reason: 'rate_limited' })
  })

  it('reports upstream_error when MSG91 returns 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))

    const result = await sendOtpViaMsg91(config, '+919876543210')

    expect(result).toEqual({ success: false, reason: 'upstream_error' })
  })

  it('reports invalid_response when MSG91 returns 200 but error body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'error', message: 'bad number' }), {
        status: 200,
      }),
    )

    const result = await sendOtpViaMsg91(config, '+91invalid')

    expect(result).toEqual({ success: false, reason: 'invalid_response' })
  })

  it('reports network_error when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))

    const result = await sendOtpViaMsg91(config, '+919876543210')

    expect(result).toEqual({ success: false, reason: 'network_error' })
  })
})

describe('verifyOtpViaMsg91', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true on a successful verify response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: 'success', message: 'OTP verified successfully' }),
        { status: 200 },
      ),
    )

    const ok = await verifyOtpViaMsg91(config, '+919876543210', '123456')

    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/control\.msg91\.com.*\/v5\/otp\/verify/)
    expect(init.method).toBe('GET')
    // Verify the query string carries phone + otp
    expect(url).toContain('mobile=919876543210')
    expect(url).toContain('otp=123456')
  })

  it('returns false on a failure response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'error', message: 'OTP not match' }), {
        status: 200,
      }),
    )

    const ok = await verifyOtpViaMsg91(config, '+919876543210', '999999')
    expect(ok).toBe(false)
  })

  it('returns false on network failure (fail-closed)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))

    const ok = await verifyOtpViaMsg91(config, '+919876543210', '123456')
    expect(ok).toBe(false)
  })

  it('returns false on non-2xx HTTP response (fail-closed)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    const ok = await verifyOtpViaMsg91(config, '+919876543210', '123456')
    expect(ok).toBe(false)
  })
})

/**
 * SECURITY REGRESSION — launch-readiness 01.
 *
 * VULNERABILITY: verifyOtpViaMsg91 used to accept the universal dev-bypass
 * code '000000' for ANY phone number whenever MSG91_AUTH_KEY was unset.
 * Production runs without MSG91 credentials (absent from terraform
 * secret_env_keys), so shipping any phone-auth UI would have shipped a
 * full authentication bypass: a missing environment variable becoming a
 * universal login. The bypass must be impossible when NODE_ENV is
 * 'production', regardless of configuration — and must keep working in
 * development and test, where live SMS is not available.
 *
 * NODE_ENV is manipulated directly with try/finally restore, per the
 * repo precedent in lib/payments/razorpay-client.test.ts.
 */
async function withNodeEnv<T>(nodeEnv: string, fn: () => Promise<T>): Promise<T> {
  const envRecord = process.env as Record<string, string | undefined>
  const original = envRecord['NODE_ENV']
  envRecord['NODE_ENV'] = nodeEnv
  try {
    return await fn()
  } finally {
    envRecord['NODE_ENV'] = original
  }
}

const noKeyConfig: Msg91Config = { authKey: '', senderId: '', templateId: '' }

describe('verifyOtpViaMsg91 dev-bypass production guard (security regression)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("rejects the '000000' bypass code in production when no auth key is configured", async () => {
    const ok = await withNodeEnv('production', () =>
      verifyOtpViaMsg91(noKeyConfig, '+919876543210', '000000'),
    )
    expect(ok).toBe(false)
  })

  it('rejects every other code in production when no auth key is configured', async () => {
    const ok = await withNodeEnv('production', () =>
      verifyOtpViaMsg91(noKeyConfig, '+919876543210', '123456'),
    )
    expect(ok).toBe(false)
  })

  it('never calls MSG91 in production when no auth key is configured (fails closed, not open)', async () => {
    await withNodeEnv('production', () =>
      verifyOtpViaMsg91(noKeyConfig, '+919876543210', '000000'),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("still accepts '000000' in development with no auth key (local dev bypass)", async () => {
    const ok = await withNodeEnv('development', () =>
      verifyOtpViaMsg91(noKeyConfig, '+919876543210', '000000'),
    )
    expect(ok).toBe(true)
  })

  it("still accepts '000000' in test/E2E with no auth key (harness bypass)", async () => {
    const ok = await withNodeEnv('test', () =>
      verifyOtpViaMsg91(noKeyConfig, '+919876543210', '000000'),
    )
    expect(ok).toBe(true)
  })

  it('still rejects non-bypass codes in development with no auth key', async () => {
    const ok = await withNodeEnv('development', () =>
      verifyOtpViaMsg91(noKeyConfig, '+919876543210', '123456'),
    )
    expect(ok).toBe(false)
  })

  it('uses the real MSG91 verify path in production when an auth key is present', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'success' }), { status: 200 }),
    )

    const ok = await withNodeEnv('production', () =>
      verifyOtpViaMsg91(config, '+919876543210', '123456'),
    )

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('sendOtpViaMsg91 dev-bypass production guard (security regression)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails closed with not_configured in production when no auth key is configured', async () => {
    const result = await withNodeEnv('production', () =>
      sendOtpViaMsg91(noKeyConfig, '+919876543210'),
    )
    expect(result).toEqual({ success: false, reason: 'not_configured' })
  })

  it('never calls MSG91 in production when no auth key is configured', async () => {
    await withNodeEnv('production', () => sendOtpViaMsg91(noKeyConfig, '+919876543210'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still short-circuits success in development with no auth key (dev bypass)', async () => {
    const result = await withNodeEnv('development', () =>
      sendOtpViaMsg91(noKeyConfig, '+919876543210'),
    )
    expect(result).toEqual({ success: true, requestId: 'dev-bypass' })
  })

  it('still short-circuits success in test/E2E with no auth key (harness bypass)', async () => {
    const result = await withNodeEnv('test', () =>
      sendOtpViaMsg91(noKeyConfig, '+919876543210'),
    )
    expect(result).toEqual({ success: true, requestId: 'dev-bypass' })
  })

  it('uses the real MSG91 send path in production when an auth key is present', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'success', request_id: 'req_9' }), {
        status: 200,
      }),
    )

    const result = await withNodeEnv('production', () =>
      sendOtpViaMsg91(config, '+919876543210'),
    )

    expect(result).toEqual({ success: true, requestId: 'req_9' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
