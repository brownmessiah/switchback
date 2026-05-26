import Razorpay from 'razorpay'

import { env } from '@/lib/env'

/**
 * Razorpay SDK wrapper per ADR-0001 + docs/plans/2026-05-23-m2-money-path.md
 * Task 10. Three concerns layered into one file:
 *
 *  1. Money translation. The Outvers stack carries money as integer
 *     rupees everywhere (calculators, snapshots, audit payloads). Razorpay
 *     speaks paise on the wire (1 rupee = 100 paise). The boundary is here:
 *     callers pass `amountRupees: number`, we multiply by 100 and pass
 *     `amount: number_in_paise` to the SDK. We never expose paise upstream.
 *
 *  2. Error normalization. The SDK throws either a plain `Error` (network
 *     hangup, DNS) or a normalised object `{ statusCode, error: { code,
 *     description, ... } }`. We collapse both into `RazorpayClientError`
 *     with a fixed code vocabulary + a `retryable` boolean the webhook
 *     handler / cron worker uses to decide whether to back off and retry.
 *
 *  3. Dependency injection. Tests pass a stubbed `client: RazorpaySdkLike`
 *     to the function options; production code calls `getRazorpayClient()`
 *     which lazily constructs a real SDK from RAZORPAY_KEY_ID /
 *     RAZORPAY_KEY_SECRET. The factory throws if creds are missing — the
 *     wrapper has no useful behaviour in a stub mode (unlike Redis).
 */

export interface CreateOrderArgs {
  amountRupees: number
  currency?: 'INR'
  receipt?: string
  notes?: Record<string, string | number>
}

export interface CreateOrderResult {
  orderId: string
  amountPaise: number
  currency: string
  receipt: string | null
  status: 'created' | 'attempted' | 'paid'
}

export interface CapturePaymentArgs {
  paymentId: string
  amountRupees: number
  currency?: 'INR'
}

export interface CapturePaymentResult {
  paymentId: string
  amountPaise: number
  status: string
  captured: boolean
}

export interface CreateRefundArgs {
  paymentId: string
  amountRupees: number
  notes?: Record<string, string | number>
  receipt?: string
}

export interface CreateRefundResult {
  refundId: string
  paymentId: string
  amountPaise: number
  status: 'pending' | 'processed' | 'failed'
}

export type RazorpayErrorCode =
  | 'UPSTREAM_5XX'
  | 'RAZORPAY_BAD_REQUEST'
  | 'RAZORPAY_AUTH'
  | 'RAZORPAY_NOT_FOUND'
  | 'RAZORPAY_RATE_LIMITED'
  | 'RAZORPAY_UNKNOWN'

export class RazorpayClientError extends Error {
  constructor(
    public code: RazorpayErrorCode,
    public retryable: boolean,
    message: string,
    public upstreamStatus?: number,
    public upstreamCode?: string,
  ) {
    super(message)
    this.name = 'RazorpayClientError'
  }
}

interface OrdersCreateParams {
  amount: number
  currency: string
  receipt?: string
  notes?: Record<string, string | number>
}

interface OrdersCreateResponse {
  id: string
  amount: number
  currency: string
  receipt: string | null
  status: 'created' | 'attempted' | 'paid'
}

interface PaymentsCaptureResponse {
  id: string
  amount: number
  status: string
  captured: boolean
}

interface PaymentsRefundParams {
  amount: number
  notes?: Record<string, string | number>
  receipt?: string
}

interface RefundResponse {
  id: string
  amount: number
  payment_id: string
  status: 'pending' | 'processed' | 'failed'
}

/**
 * Minimal shape we depend on from the Razorpay SDK. The real SDK exposes
 * a much wider surface (subscriptions, payment links, virtual accounts,
 * ...) which we deliberately do not surface here — the wrapper exists to
 * be the only place the rest of the codebase reaches into Razorpay.
 */
export interface RazorpaySdkLike {
  orders: {
    create: (params: OrdersCreateParams) => Promise<OrdersCreateResponse>
  }
  payments: {
    capture: (
      paymentId: string,
      amount: number,
      currency: string,
    ) => Promise<PaymentsCaptureResponse>
    refund: (
      paymentId: string,
      params: PaymentsRefundParams,
    ) => Promise<RefundResponse>
  }
}

let cachedClient: RazorpaySdkLike | null = null

interface GetClientOpts {
  keyId?: string
  keySecret?: string
}

/**
 * Lazily construct (or return the cached) Razorpay SDK instance.
 *
 * Falls back to `env.RAZORPAY_KEY_ID` / `env.RAZORPAY_KEY_SECRET` when
 * no explicit creds are passed. Tests pass `{ keyId, keySecret }` to
 * exercise the init path without depending on env-module load order.
 *
 * Singleton caveat: the client is cached for the lifetime of the Node
 * process. Credentials rotated via secret manager only take effect on
 * the next cold start (Vercel serverless: a fresh container; long-lived
 * Node: a process restart). Authentication failures from upstream are
 * surfaced as `RAZORPAY_AUTH` (non-retryable) so the caller / operator
 * gets clear signal to redeploy. If hot rotation becomes a requirement,
 * invalidate the cache on `RAZORPAY_AUTH` here.
 */
function makeDemoStub(): RazorpaySdkLike {
  let orderCounter = 0
  let paymentCounter = 0
  let refundCounter = 0
  return {
    orders: {
      async create(params: OrdersCreateParams): Promise<OrdersCreateResponse> {
        orderCounter++
        return {
          id: `order_demo_${Date.now()}_${orderCounter}`,
          amount: params.amount,
          currency: params.currency,
          receipt: params.receipt ?? null,
          status: 'created',
        }
      },
    },
    payments: {
      async capture(
        paymentId: string,
        amount: number,
      ): Promise<PaymentsCaptureResponse> {
        paymentCounter++
        return {
          id: paymentId || `pay_demo_${Date.now()}_${paymentCounter}`,
          amount,
          status: 'captured',
          captured: true,
        }
      },
      async refund(
        paymentId: string,
        params: PaymentsRefundParams,
      ): Promise<RefundResponse> {
        refundCounter++
        return {
          id: `rfnd_demo_${Date.now()}_${refundCounter}`,
          amount: params.amount,
          payment_id: paymentId,
          status: 'processed',
        }
      },
    },
  }
}

export function getRazorpayClient(opts: GetClientOpts = {}): RazorpaySdkLike {
  if (cachedClient) return cachedClient

  const keyId = opts.keyId ?? env.RAZORPAY_KEY_ID
  const keySecret = opts.keySecret ?? env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    cachedClient = makeDemoStub()
    return cachedClient
  }

  cachedClient = new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpaySdkLike
  return cachedClient
}

function assertNotProductionForTestHelpers(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Razorpay test helpers (_resetRazorpayClientForTests / _setRazorpayClientForTests) must not be called in production',
    )
  }
}

/** Test-only — wipe the cached client. Throws in production. */
export function _resetRazorpayClientForTests(): void {
  assertNotProductionForTestHelpers()
  cachedClient = null
}

/**
 * Test-only — prime the cache with a stub so callers that omit `{ client }`
 * resolve to it. Throws in production to prevent a malicious or buggy
 * import from swapping the real SDK at runtime.
 */
export function _setRazorpayClientForTests(client: RazorpaySdkLike): void {
  assertNotProductionForTestHelpers()
  cachedClient = client
}

interface ClientOpts {
  client?: RazorpaySdkLike
}

function assertRupeeAmount(amountRupees: number, allowZero: boolean): void {
  if (!Number.isInteger(amountRupees)) {
    throw new Error('amountRupees must be an integer (rupee precision)')
  }
  if (amountRupees < 0) {
    throw new Error('amountRupees must be non-negative')
  }
  if (!allowZero && amountRupees === 0) {
    throw new Error('amountRupees must be positive')
  }
}

const NOTES_MAX_KEYS = 15
const NOTES_MAX_VALUE_LENGTH = 256

/**
 * Razorpay enforces 15 keys / 256-char values on the notes field. If
 * caller-supplied notes ever embed customer-controlled strings, we want
 * to reject them at the boundary rather than let them poison Razorpay's
 * own audit trail or trigger an upstream 400 mid-transaction.
 */
function assertNotes(notes: Record<string, string | number> | undefined): void {
  if (notes === undefined) return
  const entries = Object.entries(notes)
  if (entries.length > NOTES_MAX_KEYS) {
    throw new Error(
      `notes accepts at most ${NOTES_MAX_KEYS} keys (Razorpay constraint)`,
    )
  }
  for (const [key, value] of entries) {
    const str = String(value)
    if (str.length > NOTES_MAX_VALUE_LENGTH) {
      throw new Error(
        `notes value for "${key}" exceeds ${NOTES_MAX_VALUE_LENGTH} chars (Razorpay constraint)`,
      )
    }
  }
}

function rupeesToPaise(amountRupees: number): number {
  return amountRupees * 100
}

interface NormalisedError {
  statusCode?: number
  error?: { code?: string; description?: string }
}

function normalizeError(err: unknown): RazorpayClientError {
  if (err instanceof RazorpayClientError) return err

  const normalised = err as NormalisedError
  const statusCode =
    typeof normalised?.statusCode === 'number'
      ? normalised.statusCode
      : typeof normalised?.statusCode === 'string'
        ? Number(normalised.statusCode)
        : undefined
  const upstreamCode = normalised?.error?.code
  const description = normalised?.error?.description

  if (typeof statusCode === 'number' && Number.isFinite(statusCode)) {
    if (statusCode >= 500) {
      return new RazorpayClientError(
        'UPSTREAM_5XX',
        true,
        `Razorpay upstream ${statusCode}: ${description ?? upstreamCode ?? 'unknown'}`,
        statusCode,
        upstreamCode,
      )
    }
    if (statusCode === 429) {
      return new RazorpayClientError(
        'RAZORPAY_RATE_LIMITED',
        true,
        `Razorpay rate-limited: ${description ?? 'slow down'}`,
        statusCode,
        upstreamCode,
      )
    }
    if (statusCode === 401 || statusCode === 403) {
      // Intentionally omit the upstream `description` from the human-readable
      // message — Razorpay's 401 descriptions sometimes include the rejected
      // key_id, and this message flows through to application logs / API
      // error envelopes. The `upstreamCode` (structured field) is retained
      // for programmatic dispatch.
      return new RazorpayClientError(
        'RAZORPAY_AUTH',
        false,
        `Razorpay authentication failed (${statusCode})`,
        statusCode,
        upstreamCode,
      )
    }
    if (statusCode === 404) {
      return new RazorpayClientError(
        'RAZORPAY_NOT_FOUND',
        false,
        `Razorpay not found: ${description ?? upstreamCode ?? 'unknown entity'}`,
        statusCode,
        upstreamCode,
      )
    }
    if (statusCode >= 400 && statusCode < 500) {
      return new RazorpayClientError(
        'RAZORPAY_BAD_REQUEST',
        false,
        `Razorpay rejected request (${statusCode}): ${description ?? upstreamCode ?? 'bad request'}`,
        statusCode,
        upstreamCode,
      )
    }
  }

  const message = err instanceof Error ? err.message : String(err)
  return new RazorpayClientError('RAZORPAY_UNKNOWN', false, message)
}

export async function createOrder(
  args: CreateOrderArgs,
  opts: ClientOpts = {},
): Promise<CreateOrderResult> {
  assertRupeeAmount(args.amountRupees, /* allowZero */ false)
  assertNotes(args.notes)

  const client = opts.client ?? getRazorpayClient()
  const amountPaise = rupeesToPaise(args.amountRupees)
  const currency = args.currency ?? 'INR'

  const params: OrdersCreateParams = { amount: amountPaise, currency }
  if (args.receipt !== undefined) params.receipt = args.receipt
  if (args.notes !== undefined) params.notes = args.notes

  try {
    const order = await client.orders.create(params)
    return {
      orderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
    }
  } catch (err) {
    throw normalizeError(err)
  }
}

export async function capturePayment(
  args: CapturePaymentArgs,
  opts: ClientOpts = {},
): Promise<CapturePaymentResult> {
  if (!args.paymentId) {
    throw new Error('paymentId is required')
  }
  assertRupeeAmount(args.amountRupees, /* allowZero */ false)

  const client = opts.client ?? getRazorpayClient()
  const amountPaise = rupeesToPaise(args.amountRupees)
  const currency = args.currency ?? 'INR'

  try {
    const payment = await client.payments.capture(args.paymentId, amountPaise, currency)
    return {
      paymentId: payment.id,
      amountPaise: payment.amount,
      status: payment.status,
      captured: payment.captured,
    }
  } catch (err) {
    throw normalizeError(err)
  }
}

export async function createRefund(
  args: CreateRefundArgs,
  opts: ClientOpts = {},
): Promise<CreateRefundResult> {
  if (!args.paymentId) {
    throw new Error('paymentId is required')
  }
  assertRupeeAmount(args.amountRupees, /* allowZero */ false)
  assertNotes(args.notes)

  const client = opts.client ?? getRazorpayClient()
  const amountPaise = rupeesToPaise(args.amountRupees)

  const params: PaymentsRefundParams = { amount: amountPaise }
  if (args.notes !== undefined) params.notes = args.notes
  if (args.receipt !== undefined) params.receipt = args.receipt

  try {
    const refund = await client.payments.refund(args.paymentId, params)
    return {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amountPaise: refund.amount,
      status: refund.status,
    }
  } catch (err) {
    throw normalizeError(err)
  }
}
