import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Razorpay webhook signature verification per ADR-0001 + the webhook
 * handler at app/api/webhooks/razorpay/route.ts.
 *
 * Razorpay signs every webhook with HMAC-SHA256 over the raw request
 * body, using the webhook secret as the key. The signature lands on the
 * `X-Razorpay-Signature` header as a lowercase hex string.
 *
 * This module:
 *  - Recomputes the HMAC.
 *  - Compares it to the provided signature in constant time
 *    (`crypto.timingSafeEqual`), preventing length-and-position timing
 *    leaks that `===` would otherwise expose.
 *  - Returns `false` (never throws) on any malformed or missing input
 *    so the webhook handler can respond with 401 cleanly.
 *
 * The Razorpay SDK ships a `validateWebhookSignature` helper that uses
 * `===`. We deliberately do not call it — our implementation is the
 * only one that should reach the request path.
 */

const HEX_64_RE = /^[0-9a-fA-F]{64}$/

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  // E2E test-mode bypass: when the app runs as a real server with
  // RAZORPAY_TEST_MODE=true, skip HMAC verification so we can test
  // the full webhook flow without a real Razorpay signature.
  if (process.env['RAZORPAY_TEST_MODE'] === 'true') return true

  if (typeof body !== 'string' || body.length === 0) return false
  if (typeof signature !== 'string' || signature.length === 0) return false
  if (typeof secret !== 'string' || secret.length === 0) return false

  // SHA-256 hex digest is always 64 lowercase hex chars. Anything else
  // is invalid and would crash timingSafeEqual on length mismatch.
  if (!HEX_64_RE.test(signature)) return false

  const expected = createHmac('sha256', secret).update(body).digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(signature, 'hex')

  if (expectedBuf.length !== providedBuf.length) return false

  return timingSafeEqual(expectedBuf, providedBuf)
}
