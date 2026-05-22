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
 */
export function getRazorpayClient(opts: GetClientOpts = {}): RazorpaySdkLike {
  if (cachedClient) return cachedClient

  const keyId = opts.keyId ?? env.RAZORPAY_KEY_ID
  const keySecret = opts.keySecret ?? env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set to use the Razorpay client',
    )
  }

  cachedClient = new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpaySdkLike
  return cachedClient
}

/** Test-only — wipe the cached client. */
export function _resetRazorpayClientForTests(): void {
  cachedClient = null
}

/** Test-only — prime the cache with a stub so callers that omit `{ client }` resolve to it. */
export function _setRazorpayClientForTests(client: RazorpaySdkLike): void {
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
      return new RazorpayClientError(
        'RAZORPAY_AUTH',
        false,
        `Razorpay auth failed (${statusCode}): ${description ?? upstreamCode ?? 'unauthorised'}`,
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
