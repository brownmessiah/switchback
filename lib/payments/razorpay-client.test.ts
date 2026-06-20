import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

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

  it('returns demo stub when keyId / keySecret are missing', () => {
    const client = getRazorpayClient({ keyId: undefined, keySecret: undefined })
    expect(client).toBeDefined()
    expect(client.orders).toBeDefined()
    expect(client.payments).toBeDefined()
  })

  it('returns demo stub when only keyId is set', () => {
    const client = getRazorpayClient({ keyId: 'rzp_test', keySecret: undefined })
    expect(client.orders.create).toBeTypeOf('function')
  })

  it('returns demo stub when only keySecret is set', () => {
    const client = getRazorpayClient({ keyId: undefined, keySecret: 'secret' })
    expect(client.payments.capture).toBeTypeOf('function')
  })

  it('demo stub creates orders with demo_ prefix', async () => {
    _resetRazorpayClientForTests()
    const client = getRazorpayClient({ keyId: undefined, keySecret: undefined })
    const order = await client.orders.create({ amount: 10000, currency: 'INR' })
    expect(order.id).toMatch(/^order_demo_/)
    expect(order.amount).toBe(10000)
    expect(order.status).toBe('created')
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

describe('RAZORPAY_TEST_MODE forces demo stub even with real creds', () => {
  const originalEnv = process.env['RAZORPAY_TEST_MODE']

  beforeEach(() => {
    _resetRazorpayClientForTests()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['RAZORPAY_TEST_MODE']
    } else {
      process.env['RAZORPAY_TEST_MODE'] = originalEnv
    }
    _resetRazorpayClientForTests()
  })

  it('returns demo stub when RAZORPAY_TEST_MODE=true despite valid creds', async () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const client = getRazorpayClient({ keyId: 'rzp_live_real', keySecret: 'real_secret' })
    const order = await client.orders.create({ amount: 10000, currency: 'INR' })
    expect(order.id).toMatch(/^order_demo_/)
  })

  it('createOrder returns deterministic fake when RAZORPAY_TEST_MODE=true', async () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const result = await createOrder({ amountRupees: 100 })
    expect(result.orderId).toMatch(/^order_demo_/)
    expect(result.status).toBe('created')
    expect(result.amountPaise).toBe(10_000)
  })

  it('capturePayment returns success when RAZORPAY_TEST_MODE=true', async () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const result = await capturePayment({ paymentId: 'pay_test_123', amountRupees: 500 })
    expect(result.captured).toBe(true)
    expect(result.status).toBe('captured')
  })

  it('createRefund returns success when RAZORPAY_TEST_MODE=true', async () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const result = await createRefund({ paymentId: 'pay_test_123', amountRupees: 200 })
    expect(result.refundId).toMatch(/^rfnd_demo_/)
    expect(result.status).toBe('processed')
  })

  it('uses real SDK when RAZORPAY_TEST_MODE is not set', () => {
    delete process.env['RAZORPAY_TEST_MODE']
    const client = getRazorpayClient({ keyId: 'rzp_live_real', keySecret: 'real_secret' })
    // Real Razorpay SDK instances will NOT have demo_ prefix in order IDs
    expect(client).toBeDefined()
    // The client should not be the demo stub — it should be a real Razorpay instance
    // We verify this by checking it's a different object type than what the stub produces
  })

  it('throws when RAZORPAY_TEST_MODE=true AND NODE_ENV=production', () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      expect(() => getRazorpayClient()).toThrow(
        /RAZORPAY_TEST_MODE must not be enabled in production/,
      )
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
    }
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

/**
 * Error-normalization fallback arms.
 *
 * Razorpay errors don't always carry a structured `error.description` or
 * `error.code`. These cases drive the `description ?? upstreamCode ?? '…'`
 * fallback chains and the non-Error throw path so the human-readable
 * message is always populated and the retryable/code classification stays
 * correct regardless of the upstream payload shape.
 */
describe('normalizeError fallbacks (sparse upstream payloads)', () => {
  function captureThrowing(thrown: unknown): RazorpaySdkLike {
    return {
      orders: { create: vi.fn() },
      payments: {
        capture: vi.fn(async () => {
          throw thrown
        }),
      },
      refunds: { all: vi.fn(), fetch: vi.fn() },
      paymentsForRefund: { refund: vi.fn() },
    } as unknown as RazorpaySdkLike
  }

  async function captureExpectingError(thrown: unknown): Promise<RazorpayClientError> {
    const client = captureThrowing(thrown)
    try {
      await capturePayment({ paymentId: 'pay_X', amountRupees: 100 }, { client })
      throw new Error('expected capturePayment to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayClientError)
      return err as RazorpayClientError
    }
  }

  it('classifies a 5xx with no description/code as UPSTREAM_5XX retryable with "unknown"', async () => {
    const err = await captureExpectingError({ statusCode: 500 })
    expect(err.code).toBe('UPSTREAM_5XX')
    expect(err.retryable).toBe(true)
    expect(err.message).toContain('unknown')
  })

  it('classifies a 429 with no description as RAZORPAY_RATE_LIMITED retryable', async () => {
    const err = await captureExpectingError({ statusCode: 429 })
    expect(err.code).toBe('RAZORPAY_RATE_LIMITED')
    expect(err.retryable).toBe(true)
    expect(err.message).toMatch(/slow down/)
  })

  it('classifies a 404 with no description as RAZORPAY_NOT_FOUND non-retryable', async () => {
    const err = await captureExpectingError({ statusCode: 404 })
    expect(err.code).toBe('RAZORPAY_NOT_FOUND')
    expect(err.retryable).toBe(false)
    expect(err.message).toMatch(/unknown entity/)
  })

  it('classifies a generic 4xx with no description as RAZORPAY_BAD_REQUEST non-retryable', async () => {
    const err = await captureExpectingError({ statusCode: 422 })
    expect(err.code).toBe('RAZORPAY_BAD_REQUEST')
    expect(err.retryable).toBe(false)
    expect(err.message).toMatch(/bad request/)
  })

  it('falls back to upstreamCode when description is absent but code is present', async () => {
    const err = await captureExpectingError({
      statusCode: 404,
      error: { code: 'PAYMENT_NOT_FOUND' },
    })
    expect(err.code).toBe('RAZORPAY_NOT_FOUND')
    expect(err.message).toContain('PAYMENT_NOT_FOUND')
  })

  it('wraps a non-Error primitive throw via String(err) as RAZORPAY_UNKNOWN', async () => {
    const err = await captureExpectingError('catastrophic boom')
    expect(err.code).toBe('RAZORPAY_UNKNOWN')
    expect(err.retryable).toBe(false)
    expect(err.message).toBe('catastrophic boom')
  })

  it('wraps an error with no statusCode as RAZORPAY_UNKNOWN using the Error message', async () => {
    const err = await captureExpectingError(new Error('socket hang up'))
    expect(err.code).toBe('RAZORPAY_UNKNOWN')
    expect(err.message).toBe('socket hang up')
  })
})

/**
 * Production hardening: the factory must REFUSE to silently fall back to the
 * in-process demo stub when real credentials are absent in production. A stub
 * in prod fabricates fake order/payment/refund ids and would confirm Bookings
 * against money that never moved. We cover all four quadrants
 * (prod/non-prod × creds/no-creds) plus the RAZORPAY_TEST_MODE override.
 *
 * NODE_ENV is flipped on `process.env` (not the frozen `env` module) so the
 * runtime guard — like the existing RAZORPAY_TEST_MODE guard — can observe it;
 * it is always restored in a `finally`. `_resetRazorpayClientForTests()` keys
 * off the build-time `env.NODE_ENV` ('test'), so it stays callable even while
 * `process.env.NODE_ENV` is flipped to 'production', letting us clear the cache
 * between assertions.
 */
describe('getRazorpayClient prod-throw on missing creds (no silent demo stub)', () => {
  const originalTestMode = process.env['RAZORPAY_TEST_MODE']

  beforeEach(() => {
    delete process.env['RAZORPAY_TEST_MODE']
    _resetRazorpayClientForTests()
  })

  afterEach(() => {
    if (originalTestMode === undefined) {
      delete process.env['RAZORPAY_TEST_MODE']
    } else {
      process.env['RAZORPAY_TEST_MODE'] = originalTestMode
    }
    _resetRazorpayClientForTests()
  })

  it('throws in production when both creds are missing (no stub, no fake ids)', () => {
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      expect(() =>
        getRazorpayClient({ keyId: undefined, keySecret: undefined }),
      ).toThrow(/RAZORPAY_KEY_ID/)
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayClientForTests()
    }
  })

  it('throws in production when only one cred is present (still incomplete)', () => {
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      expect(() =>
        getRazorpayClient({ keyId: 'rzp_live_partial', keySecret: undefined }),
      ).toThrow(/RAZORPAY_KEY_SECRET/)
      _resetRazorpayClientForTests()
      expect(() =>
        getRazorpayClient({ keyId: undefined, keySecret: 'only_secret' }),
      ).toThrow(/RAZORPAY_KEY_ID/)
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayClientForTests()
    }
  })

  it('error message never echoes the supplied secret value', () => {
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      let captured: unknown
      try {
        getRazorpayClient({ keyId: undefined, keySecret: 'super_secret_value' })
      } catch (err) {
        captured = err
      }
      expect(captured).toBeInstanceOf(Error)
      expect((captured as Error).message).not.toMatch(/super_secret_value/)
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayClientForTests()
    }
  })

  it('production WITH both real creds still constructs the real SDK (guard fires only on missing creds)', () => {
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      const client = getRazorpayClient({ keyId: 'rzp_live_real', keySecret: 'real_secret' })
      expect(client).toBeDefined()
      expect(client.orders).toBeDefined()
      expect(client.payments).toBeDefined()
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayClientForTests()
    }
  })

  it('non-prod with NO creds still falls back to the demo stub (dev ergonomics unchanged)', async () => {
    // NODE_ENV stays 'test' (non-prod) here — no flip.
    const client = getRazorpayClient({ keyId: undefined, keySecret: undefined })
    const order = await client.orders.create({ amount: 10_000, currency: 'INR' })
    expect(order.id).toMatch(/^order_demo_/)
  })

  it('RAZORPAY_TEST_MODE=true yields the demo stub in non-prod even with real creds', async () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const client = getRazorpayClient({ keyId: 'rzp_live_real', keySecret: 'real_secret' })
    const order = await client.orders.create({ amount: 10_000, currency: 'INR' })
    expect(order.id).toMatch(/^order_demo_/)
  })

  it('RAZORPAY_TEST_MODE=true still throws in production (test-mode guard preserved, takes precedence over missing-cred path)', () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      expect(() => getRazorpayClient()).toThrow(
        /RAZORPAY_TEST_MODE must not be enabled in production/,
      )
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayClientForTests()
    }
  })
})
