import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Thin-adapter contract test for the Razorpay X payout webhook route.
 *
 * The route's only job is to read the raw body + the X signature/event-id
 * headers and hand them to `processRazorpayXWebhook` with the X secret
 * (RAZORPAYX_WEBHOOK_SECRET — NOT the PG RAZORPAY_WEBHOOK_SECRET). Status +
 * body come straight from the handler's result envelope. The money logic is
 * exercised against a real PGlite db in razorpayx-webhook.test.ts.
 */

const processRazorpayXWebhook = vi.fn()

vi.mock('@/lib/payments/razorpayx-webhook', () => ({
  processRazorpayXWebhook: (args: unknown) => processRazorpayXWebhook(args),
}))

vi.mock('@/db/client', () => ({ db: { __marker: 'real-db' } }))

vi.mock('@/lib/env', () => ({
  env: {
    RAZORPAYX_WEBHOOK_SECRET: 'whsec_x_route',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_pg_route',
  },
}))

vi.mock('next/headers', () => ({
  headers: async () =>
    new Map([
      ['x-razorpay-signature', 'sig_from_header'],
      ['x-razorpay-event-id', 'evt_from_header'],
    ]),
}))

describe('POST /api/webhooks/razorpayx', () => {
  beforeEach(() => {
    processRazorpayXWebhook.mockReset()
  })

  it('passes the body, X headers, and the X webhook secret to the handler; mirrors its status', async () => {
    processRazorpayXWebhook.mockResolvedValue({ status: 200, body: { ok: true } })
    const { POST } = await import('./route')

    const req = new Request('http://localhost/api/webhooks/razorpayx', {
      method: 'POST',
      body: '{"event":"payout.processed"}',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    expect(processRazorpayXWebhook).toHaveBeenCalledTimes(1)
    const arg = processRazorpayXWebhook.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.body).toBe('{"event":"payout.processed"}')
    expect(arg.signature).toBe('sig_from_header')
    expect(arg.eventIdHeader).toBe('evt_from_header')
    // The X secret, NOT the PG secret.
    expect(arg.secret).toBe('whsec_x_route')
    expect(arg.secret).not.toBe('whsec_pg_route')
  })

  it('propagates the handler status code (e.g. 401 invalid signature)', async () => {
    processRazorpayXWebhook.mockResolvedValue({
      status: 401,
      body: { error: 'invalid signature' },
    })
    const { POST } = await import('./route')

    const req = new Request('http://localhost/api/webhooks/razorpayx', {
      method: 'POST',
      body: 'x',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
