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

/**
 * MSG91's send-OTP API requires template_id, and for Indian numbers that
 * template must be DLT-registered (TRAI). Sending an empty one returns MSG91
 * error 211 ("No DLT Template ID or Invalid Template ID"), which reaches us as
 * an opaque upstream failure.
 *
 * That is a live trap during setup: the auth key usually arrives BEFORE the
 * DLT template is approved, so the half-configured state is the normal one.
 * Guarding on the auth key alone would let it through and make a missing
 * template look like a flaky provider.
 */
describe('sendOtpViaMsg91 — incomplete configuration', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not call MSG91 when the template id is missing', async () => {
    const result = await sendOtpViaMsg91({ ...config, templateId: '' }, '+919876543210')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, reason: 'not_configured' })
  })

  it('does not call MSG91 when the sender id is missing', async () => {
    const result = await sendOtpViaMsg91({ ...config, senderId: '' }, '+919876543210')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, reason: 'not_configured' })
  })

  it('keeps the dev bypass when NOTHING is configured', async () => {
    // A developer with no MSG91 setup at all still gets a working local flow.
    const result = await sendOtpViaMsg91(
      { authKey: '', senderId: '', templateId: '' },
      '+919876543210',
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, requestId: 'dev-bypass' })
  })

  it('still sends when everything is configured', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'success', request_id: 'req_ok' }), { status: 200 }),
    )

    const result = await sendOtpViaMsg91(config, '+919876543210')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true, requestId: 'req_ok' })
  })
})

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
