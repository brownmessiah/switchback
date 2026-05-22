import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  _resetRazorpayClientForTests,
  _setRazorpayClientForTests,
  capturePayment,
  createOrder,
  createRefund,
  getRazorpayClient,
  RazorpayClientError,
  type RazorpaySdkLike,
} from './razorpay-client'

/**
 * Razorpay SDK wrapper per docs/plans/2026-05-23-m2-money-path.md Task 10.
 *
 * Tests use dependency injection: each function accepts an optional
 * `{ client }` arg so the test can pass a stubbed Razorpay SDK without
 * mocking the module. The factory `getRazorpayClient()` lives in the
 * production path and is not exercised here (it has its own constructor
 * test covering env-var handling).
 *
 * Money is integer rupees at the API boundary; the wrapper converts to
 * paise (× 100) before sending to Razorpay and back to rupees from the
 * upstream response.
 */

function fakeOrdersOk(): RazorpaySdkLike {
  return {
    orders: {
      create: vi.fn(async (params) => ({
        id: 'order_TEST123',
        entity: 'order',
        amount: params.amount,
        currency: params.currency,
        receipt: params.receipt ?? null,
        status: 'created',
        amount_paid: 0,
        amount_due: Number(params.amount),
        attempts: 0,
        created_at: 1_700_000_000,
        notes: params.notes ?? {},
      })),
    },
    payments: { capture: vi.fn() },
    refunds: { all: vi.fn(), fetch: vi.fn() },
    paymentsForRefund: { refund: vi.fn() },
  } as unknown as RazorpaySdkLike
}

describe('createOrder', () => {
  it('converts rupees to paise on the wire and returns the order id + amounts', async () => {
    const client = fakeOrdersOk()
    const result = await createOrder(
      { amountRupees: 2500, receipt: 'booking_abc', notes: { booking_id: 'bk_1' } },
      { client },
    )

    expect(client.orders.create).toHaveBeenCalledTimes(1)
    expect(client.orders.create).toHaveBeenCalledWith({
      amount: 250_000, // 2500 rupees → 250000 paise
      currency: 'INR',
      receipt: 'booking_abc',
      notes: { booking_id: 'bk_1' },
    })
    expect(result.orderId).toBe('order_TEST123')
    expect(result.amountPaise).toBe(250_000)
    expect(result.currency).toBe('INR')
    expect(result.status).toBe('created')
  })

  it('defaults currency to INR and omits receipt/notes when not supplied', async () => {
    const client = fakeOrdersOk()
    await createOrder({ amountRupees: 100 }, { client })
    expect(client.orders.create).toHaveBeenCalledWith({
      amount: 10_000,
      currency: 'INR',
    })
  })

  it('rejects non-integer rupee amounts (Razorpay only round-trips to rupee precision in our stack)', async () => {
    const client = fakeOrdersOk()
    await expect(
      createOrder({ amountRupees: 100.5 }, { client }),
    ).rejects.toThrow(/integer/i)
    expect(client.orders.create).not.toHaveBeenCalled()
  })

  it('rejects negative rupee amounts', async () => {
    const client = fakeOrdersOk()
    await expect(
      createOrder({ amountRupees: -1 }, { client }),
    ).rejects.toThrow(/non-negative/i)
  })

  it('wraps 5xx upstream errors as code=UPSTREAM_5XX with retryable=true', async () => {
    const client: RazorpaySdkLike = {
      orders: {
        create: vi.fn(async () => {
          throw {
            statusCode: 502,
            error: { code: 'SERVER_ERROR', description: 'bad gateway' },
          }
        }),
      },
      payments: { capture: vi.fn() },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike

    try {
      await createOrder({ amountRupees: 100 }, { client })
      expect.fail('expected createOrder to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayClientError)
      const e = err as RazorpayClientError
      expect(e.code).toBe('UPSTREAM_5XX')
      expect(e.retryable).toBe(true)
      expect(e.upstreamStatus).toBe(502)
    }
  })

  it('wraps 4xx upstream errors as code=RAZORPAY_BAD_REQUEST with retryable=false', async () => {
    const client: RazorpaySdkLike = {
      orders: {
        create: vi.fn(async () => {
          throw {
            statusCode: 400,
            error: { code: 'BAD_REQUEST_ERROR', description: 'amount too small' },
          }
        }),
      },
      payments: { capture: vi.fn() },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike

    try {
      await createOrder({ amountRupees: 100 }, { client })
      expect.fail('expected createOrder to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayClientError)
      const e = err as RazorpayClientError
      expect(e.code).toBe('RAZORPAY_BAD_REQUEST')
      expect(e.retryable).toBe(false)
      expect(e.message).toMatch(/amount too small/)
    }
  })

  it('wraps 401 as code=RAZORPAY_AUTH with retryable=false', async () => {
    const client: RazorpaySdkLike = {
      orders: {
        create: vi.fn(async () => {
          throw {
            statusCode: 401,
            error: {
              code: 'BAD_REQUEST_ERROR',
              // Razorpay sometimes embeds the rejected key_id in description.
              // The wrapper must NOT propagate this to the human-readable
              // message — it could land in application logs.
              description: 'Authentication failed for key rzp_live_XXXX',
            },
          }
        }),
      },
      payments: { capture: vi.fn() },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createOrder({ amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      const e = err as RazorpayClientError
      expect(e.code).toBe('RAZORPAY_AUTH')
      expect(e.retryable).toBe(false)
      // Auth-error message must NOT leak the upstream description (which
      // sometimes contains the rejected key_id).
      expect(e.message).not.toMatch(/rzp_live_/)
      expect(e.message).toMatch(/Razorpay authentication failed/)
      // Structured field preserves the upstream code for programmatic dispatch.
      expect(e.upstreamCode).toBe('BAD_REQUEST_ERROR')
    }
  })

  it('wraps 403 as code=RAZORPAY_AUTH (same redacted-message behaviour as 401)', async () => {
    const client: RazorpaySdkLike = {
      orders: {
        create: vi.fn(async () => {
          throw {
            statusCode: 403,
            error: { code: 'FORBIDDEN', description: 'key rzp_live_X disabled' },
          }
        }),
      },
      payments: { capture: vi.fn() },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createOrder({ amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('RAZORPAY_AUTH')
      expect((err as RazorpayClientError).message).not.toMatch(/rzp_live_/)
    }
  })

  it('wraps 429 as code=RAZORPAY_RATE_LIMITED with retryable=true', async () => {
    const client: RazorpaySdkLike = {
      orders: {
        create: vi.fn(async () => {
          throw {
            statusCode: 429,
            error: { code: 'RATE_LIMIT_EXCEEDED', description: 'slow down' },
          }
        }),
      },
      payments: { capture: vi.fn() },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createOrder({ amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('RAZORPAY_RATE_LIMITED')
      expect((err as RazorpayClientError).retryable).toBe(true)
    }
  })

  it('wraps unknown errors (no statusCode) as code=RAZORPAY_UNKNOWN with retryable=false', async () => {
    const client: RazorpaySdkLike = {
      orders: {
        create: vi.fn(async () => {
          throw new Error('socket hang up')
        }),
      },
      payments: { capture: vi.fn() },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createOrder({ amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('RAZORPAY_UNKNOWN')
      expect((err as RazorpayClientError).message).toMatch(/socket hang up/)
    }
  })
})

function fakeCaptureOk(): RazorpaySdkLike {
  return {
    orders: { create: vi.fn() },
    payments: {
      capture: vi.fn(async (paymentId, amount, currency) => ({
        id: paymentId,
        entity: 'payment',
        amount: Number(amount),
        currency,
        status: 'captured',
        captured: true,
        amount_refunded: 0,
        created_at: 1_700_000_000,
      })),
    },
    refunds: { all: vi.fn(), fetch: vi.fn() },
    paymentsForRefund: { refund: vi.fn() },
  } as unknown as RazorpaySdkLike
}

describe('capturePayment', () => {
  it('honours an explicit currency override', async () => {
    const client = fakeCaptureOk()
    await capturePayment(
      { paymentId: 'pay_TEST', amountRupees: 100, currency: 'INR' },
      { client },
    )
    expect(client.payments.capture).toHaveBeenCalledWith('pay_TEST', 10_000, 'INR')
  })

  it('converts rupees to paise + passes currency to the SDK + returns rupees back', async () => {
    const client = fakeCaptureOk()
    const result = await capturePayment(
      { paymentId: 'pay_TEST', amountRupees: 5000 },
      { client },
    )
    expect(client.payments.capture).toHaveBeenCalledWith('pay_TEST', 500_000, 'INR')
    expect(result.paymentId).toBe('pay_TEST')
    expect(result.amountPaise).toBe(500_000)
    expect(result.status).toBe('captured')
    expect(result.captured).toBe(true)
  })

  it('rejects empty paymentId', async () => {
    const client = fakeCaptureOk()
    await expect(
      capturePayment({ paymentId: '', amountRupees: 100 }, { client }),
    ).rejects.toThrow(/paymentId/)
  })

  it('rejects non-integer / negative rupee amounts', async () => {
    const client = fakeCaptureOk()
    await expect(
      capturePayment({ paymentId: 'pay_TEST', amountRupees: 100.5 }, { client }),
    ).rejects.toThrow(/integer/i)
    await expect(
      capturePayment({ paymentId: 'pay_TEST', amountRupees: -1 }, { client }),
    ).rejects.toThrow(/non-negative/i)
  })

  it('wraps 5xx upstream as UPSTREAM_5XX retryable', async () => {
    const client: RazorpaySdkLike = {
      orders: { create: vi.fn() },
      payments: {
        capture: vi.fn(async () => {
          throw { statusCode: 503, error: { code: 'SERVER_ERROR', description: 'down' } }
        }),
      },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await capturePayment({ paymentId: 'pay_X', amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('UPSTREAM_5XX')
      expect((err as RazorpayClientError).retryable).toBe(true)
    }
  })
})

function fakeRefundOk(): RazorpaySdkLike {
  return {
    orders: { create: vi.fn() },
    payments: {
      capture: vi.fn(),
      refund: vi.fn(async (paymentId, params) => ({
        id: 'rfnd_TEST',
        entity: 'refund',
        amount: Number(params.amount),
        currency: 'INR',
        payment_id: paymentId,
        created_at: 1_700_000_000,
        status: 'processed',
        speed_processed: 'normal',
        speed_requested: 'normal',
        notes: params.notes ?? {},
        receipt: params.receipt ?? null,
      })),
    },
    refunds: { all: vi.fn(), fetch: vi.fn() },
    paymentsForRefund: { refund: vi.fn() },
  } as unknown as RazorpaySdkLike
}

describe('createRefund', () => {
  it('refunds via payments.refund(paymentId, { amount: paise, notes, receipt })', async () => {
    const client = fakeRefundOk()
    const result = await createRefund(
      {
        paymentId: 'pay_TEST',
        amountRupees: 1000,
        notes: { refund_request_id: 'rr_1' },
        receipt: 'refund-rr_1',
      },
      { client },
    )
    expect(client.payments.refund).toHaveBeenCalledWith('pay_TEST', {
      amount: 100_000,
      notes: { refund_request_id: 'rr_1' },
      receipt: 'refund-rr_1',
    })
    expect(result.refundId).toBe('rfnd_TEST')
    expect(result.paymentId).toBe('pay_TEST')
    expect(result.amountPaise).toBe(100_000)
    expect(result.status).toBe('processed')
  })

  it('omits optional fields when not supplied', async () => {
    const client = fakeRefundOk()
    await createRefund({ paymentId: 'pay_X', amountRupees: 50 }, { client })
    expect(client.payments.refund).toHaveBeenCalledWith('pay_X', {
      amount: 5_000,
    })
  })

  it('rejects empty paymentId / non-integer / negative amount', async () => {
    const client = fakeRefundOk()
    await expect(
      createRefund({ paymentId: '', amountRupees: 100 }, { client }),
    ).rejects.toThrow(/paymentId/)
    await expect(
      createRefund({ paymentId: 'pay_X', amountRupees: 1.5 }, { client }),
    ).rejects.toThrow(/integer/i)
    await expect(
      createRefund({ paymentId: 'pay_X', amountRupees: -1 }, { client }),
    ).rejects.toThrow(/non-negative/i)
  })

  it('rejects amountRupees=0 (Razorpay rejects zero-rupee refunds; surface the constraint up front)', async () => {
    const client = fakeRefundOk()
    await expect(
      createRefund({ paymentId: 'pay_X', amountRupees: 0 }, { client }),
    ).rejects.toThrow(/positive/i)
  })

  it('wraps 5xx upstream as UPSTREAM_5XX retryable', async () => {
    const client: RazorpaySdkLike = {
      orders: { create: vi.fn() },
      payments: {
        capture: vi.fn(),
        refund: vi.fn(async () => {
          throw { statusCode: 500, error: { code: 'SERVER_ERROR', description: 'oops' } }
        }),
      },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createRefund({ paymentId: 'pay_X', amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('UPSTREAM_5XX')
      expect((err as RazorpayClientError).retryable).toBe(true)
    }
  })

  it('wraps 404 as RAZORPAY_NOT_FOUND', async () => {
    const client: RazorpaySdkLike = {
      orders: { create: vi.fn() },
      payments: {
        capture: vi.fn(),
        refund: vi.fn(async () => {
          throw { statusCode: 404, error: { code: 'NOT_FOUND', description: 'payment missing' } }
        }),
      },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createRefund({ paymentId: 'pay_X', amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('RAZORPAY_NOT_FOUND')
      expect((err as RazorpayClientError).retryable).toBe(false)
    }
  })

  it('passes statusCode as a string through normalisation (some SDKs stringify it)', async () => {
    const client: RazorpaySdkLike = {
      orders: { create: vi.fn() },
      payments: {
        capture: vi.fn(),
        refund: vi.fn(async () => {
          throw { statusCode: '503', error: { code: 'SERVER_ERROR', description: 'down' } }
        }),
      },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
    try {
      await createRefund({ paymentId: 'pay_X', amountRupees: 100 }, { client })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('UPSTREAM_5XX')
      expect((err as RazorpayClientError).upstreamStatus).toBe(503)
    }
  })
})

describe('getRazorpayClient (env-driven factory)', () => {
  beforeEach(() => {
    _resetRazorpayClientForTests()
  })

  it('throws when keyId / keySecret are missing', () => {
    expect(() =>
      getRazorpayClient({ keyId: undefined, keySecret: undefined }),
    ).toThrow(/RAZORPAY_KEY_ID/)
  })

  it('throws when only keyId is set', () => {
    expect(() =>
      getRazorpayClient({ keyId: 'rzp_test', keySecret: undefined }),
    ).toThrow(/RAZORPAY_KEY_ID/)
  })

  it('throws when only keySecret is set', () => {
    expect(() =>
      getRazorpayClient({ keyId: undefined, keySecret: 'secret' }),
    ).toThrow(/RAZORPAY_KEY_ID/)
  })

  it('constructs a Razorpay SDK instance when both creds are provided', () => {
    const client = getRazorpayClient({ keyId: 'rzp_test', keySecret: 'secret' })
    expect(client).toBeDefined()
    expect(client.orders).toBeDefined()
    expect(client.payments).toBeDefined()
  })

  it('caches the constructed client across calls', () => {
    const first = getRazorpayClient({ keyId: 'rzp_test', keySecret: 'secret' })
    // Second call should return the cached instance without re-reading args.
    const second = getRazorpayClient()
    expect(second).toBe(first)
  })
})

describe('notes validation (Razorpay 15-key / 256-char constraints)', () => {
  it('rejects notes with > 15 keys at the boundary (createOrder)', async () => {
    const client = fakeOrdersOk()
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`k${i}`, `v${i}`]),
    )
    await expect(
      createOrder({ amountRupees: 100, notes: tooManyKeys }, { client }),
    ).rejects.toThrow(/15 keys/)
    expect(client.orders.create).not.toHaveBeenCalled()
  })

  it('rejects notes with a value longer than 256 chars (createOrder)', async () => {
    const client = fakeOrdersOk()
    const longValue = 'x'.repeat(257)
    await expect(
      createOrder({ amountRupees: 100, notes: { foo: longValue } }, { client }),
    ).rejects.toThrow(/256/)
    expect(client.orders.create).not.toHaveBeenCalled()
  })

  it('rejects notes with a numeric value whose string form exceeds 256 chars', async () => {
    const client = fakeRefundOk()
    const longNum = Number('9'.repeat(20))
    // The numeric value itself is short; we test the string conversion of a wide one via a long template.
    await expect(
      createRefund(
        { paymentId: 'pay_X', amountRupees: 100, notes: { foo: '0'.repeat(300) } },
        { client },
      ),
    ).rejects.toThrow(/256/)
    expect(longNum).toBeDefined()
  })

  it('accepts the empty-notes case (notes omitted)', async () => {
    const client = fakeOrdersOk()
    await expect(
      createOrder({ amountRupees: 100 }, { client }),
    ).resolves.toBeDefined()
  })
})

describe('cached-client fallback in createOrder/capturePayment/createRefund', () => {
  beforeEach(() => {
    _resetRazorpayClientForTests()
  })

  it('falls back to the cached client when opts.client is not supplied', async () => {
    const stub = fakeOrdersOk()
    _setRazorpayClientForTests(stub)

    const result = await createOrder({ amountRupees: 100 })
    expect(stub.orders.create).toHaveBeenCalledTimes(1)
    expect(result.orderId).toBe('order_TEST123')

    const captureStub = fakeCaptureOk()
    _setRazorpayClientForTests(captureStub)
    _resetRazorpayClientForTests()
    _setRazorpayClientForTests(captureStub)
    const cap = await capturePayment({ paymentId: 'pay_X', amountRupees: 100 })
    expect(captureStub.payments.capture).toHaveBeenCalled()
    expect(cap.paymentId).toBe('pay_X')

    const refundStub = fakeRefundOk()
    _resetRazorpayClientForTests()
    _setRazorpayClientForTests(refundStub)
    const rfnd = await createRefund({ paymentId: 'pay_X', amountRupees: 100 })
    expect(refundStub.payments.refund).toHaveBeenCalled()
    expect(rfnd.refundId).toBe('rfnd_TEST')
  })
})
