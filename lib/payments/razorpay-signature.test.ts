import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { verifyWebhookSignature } from './razorpay-signature'

/**
 * Razorpay webhook signature verification — HMAC-SHA256 over the raw body
 * using the webhook secret. Compared in constant time (crypto.timingSafeEqual)
 * to prevent signature-length / character-position timing leaks.
 *
 * The SDK's own validateWebhookSignature uses `===` which is technically
 * timing-leaky against a sophisticated attacker on the same host. Our
 * verifier uses timingSafeEqual; tests assert that property indirectly by
 * checking length-mismatch returns false instead of throwing.
 */

const SECRET = 'whsec_test_switchback'

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyWebhookSignature', () => {
  it('returns true for a valid HMAC-SHA256 over the body', () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'evt_1' })
    const signature = sign(body, SECRET)
    expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true)
  })

  it('returns false when the body is tampered with', () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'evt_1' })
    const signature = sign(body, SECRET)
    const tampered = body.replace('captured', 'failed')
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false)
  })

  it('returns false when the signature is tampered with', () => {
    const body = '{"event":"payment.captured"}'
    const signature = sign(body, SECRET)
    const flipped =
      signature.slice(0, -2) + (signature.slice(-2) === 'ff' ? '00' : 'ff')
    expect(verifyWebhookSignature(body, flipped, SECRET)).toBe(false)
  })

  it('returns false when the secret is wrong', () => {
    const body = '{"event":"payment.captured"}'
    const signature = sign(body, SECRET)
    expect(verifyWebhookSignature(body, signature, 'wrong_secret')).toBe(false)
  })

  it('returns false on an empty signature (header missing)', () => {
    const body = '{"event":"payment.captured"}'
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false)
  })

  it('returns false on a signature that is not the right hex length', () => {
    // Wrong length must NOT throw — timingSafeEqual would otherwise raise.
    const body = '{"event":"payment.captured"}'
    expect(verifyWebhookSignature(body, 'deadbeef', SECRET)).toBe(false)
  })

  it('returns false on a non-hex signature (would fail Buffer.from + length check)', () => {
    const body = '{"event":"payment.captured"}'
    expect(verifyWebhookSignature(body, 'not-a-hex-signature-zzzz', SECRET)).toBe(false)
  })

  it('returns false when the secret is empty', () => {
    const body = '{"event":"payment.captured"}'
    const signature = sign(body, SECRET)
    expect(verifyWebhookSignature(body, signature, '')).toBe(false)
  })

  it('treats null / undefined inputs as invalid (returns false rather than throwing)', () => {
    expect(
      verifyWebhookSignature(null as unknown as string, 'abc', SECRET),
    ).toBe(false)
    expect(
      verifyWebhookSignature('body', null as unknown as string, SECRET),
    ).toBe(false)
    expect(
      verifyWebhookSignature('body', 'abc', null as unknown as string),
    ).toBe(false)
  })

  it('handles utf-8 bodies (emoji, multi-byte) correctly', () => {
    const body = JSON.stringify({ event: 'payment.captured', notes: { customer: 'गौरव 🚣' } })
    const signature = sign(body, SECRET)
    expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true)
  })

  it('returns true for the exact hex case Razorpay sends (lowercase hex digest)', () => {
    const body = '{"event":"payment.captured","payload":{}}'
    const signature = createHmac('sha256', SECRET).update(body).digest('hex')
    expect(signature).toMatch(/^[0-9a-f]+$/)
    expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true)
  })

  describe('RAZORPAY_TEST_MODE bypass', () => {
    const originalEnv = process.env['RAZORPAY_TEST_MODE']

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env['RAZORPAY_TEST_MODE']
      } else {
        process.env['RAZORPAY_TEST_MODE'] = originalEnv
      }
    })

    it('returns true for any inputs when RAZORPAY_TEST_MODE=true', () => {
      process.env['RAZORPAY_TEST_MODE'] = 'true'
      expect(
        verifyWebhookSignature('any-body', 'wrong-signature', 'wrong-secret'),
      ).toBe(true)
    })

    it('still validates normally when RAZORPAY_TEST_MODE is not set', () => {
      delete process.env['RAZORPAY_TEST_MODE']
      expect(
        verifyWebhookSignature('any-body', 'wrong-signature', 'wrong-secret'),
      ).toBe(false)
    })

    it('still validates normally when RAZORPAY_TEST_MODE=false', () => {
      process.env['RAZORPAY_TEST_MODE'] = 'false'
      expect(
        verifyWebhookSignature('any-body', 'wrong-signature', 'wrong-secret'),
      ).toBe(false)
    })

    it('throws when RAZORPAY_TEST_MODE=true AND NODE_ENV=production', () => {
      process.env['RAZORPAY_TEST_MODE'] = 'true'
      const envRecord = process.env as Record<string, string | undefined>
      const origNodeEnv = envRecord['NODE_ENV']
      envRecord['NODE_ENV'] = 'production'
      try {
        expect(() =>
          verifyWebhookSignature('any-body', 'any-sig', 'any-secret'),
        ).toThrow(/RAZORPAY_TEST_MODE must not be enabled in production/)
      } finally {
        envRecord['NODE_ENV'] = origNodeEnv
      }
    })
  })
})
