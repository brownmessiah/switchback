import { env } from '@/lib/env'

import { normalizeError } from './razorpay-client'

/**
 * Razorpay X choke-point per ADR-0016 (2026-06-18 amendment, D8). The single
 * place the rest of the codebase reaches the Razorpay X API for Contacts,
 * Fund Accounts, and Payouts — the I/O layer the Payout Batch path (later
 * slices) builds on.
 *
 * Mirrors the discipline of razorpay-client.ts (the PG collection client):
 *
 *  1. Money translation. Money is integer rupees everywhere in the stack;
 *     Razorpay speaks paise on the wire (1 rupee = 100 paise). `createPayout`
 *     takes `amountRupees` and multiplies by 100 here. Contacts/Fund Accounts
 *     carry no money.
 *
 *  2. Error normalization. Both transports (fetch network failure, Razorpay
 *     HTTP error envelope) collapse into `RazorpayClientError` via the SHARED
 *     `normalizeError` from razorpay-client.ts — one source of truth for the
 *     status→code mapping and the `retryable` boolean the cron/webhook use.
 *
 *  3. Dependency injection. The three exported functions accept an optional
 *     `{ client }` so tests inject a stub. Production calls
 *     `getRazorpayXClient()`, which lazily constructs a fetch-backed real
 *     client and throws when creds are missing in production (never a silent
 *     demo stub — a stub would fabricate payout ids and "complete" money that
 *     never moved).
 *
 * Why fetch and not the SDK: the installed `razorpay` SDK has no Contacts /
 * Payouts modules (Razorpay X is a separate API surface). We hit
 * `https://api.razorpay.com/v1/{contacts,fund_accounts,payouts}` directly with
 * HTTP Basic auth — Razorpay X uses the SAME key auth as the PG API.
 *
 * NOTE: this is NOT a 'use server' module — no business logic, pure I/O.
 */

const RAZORPAYX_API_BASE = 'https://api.razorpay.com/v1'

// ───────────────────────────── public types ────────────────────────────────

export type RazorpayXContactType = 'vendor' | 'customer' | 'employee' | 'self'

export interface CreateContactInput {
  name: string
  type: RazorpayXContactType
  referenceId?: string
  email?: string
  contact?: string
}

export interface CreateContactResult {
  contactId: string
}

export type RazorpayXFundAccountType = 'bank_account' | 'vpa'

export interface CreateFundAccountInput {
  contactId: string
  accountType: RazorpayXFundAccountType
  /** Required when accountType is 'bank_account'. */
  bankAccount?: { name: string; ifsc: string; accountNumber: string }
  /** Required when accountType is 'vpa'. */
  vpa?: { address: string }
}

export interface CreateFundAccountResult {
  fundAccountId: string
}

export type RazorpayXPayoutMode = 'IMPS' | 'NEFT' | 'UPI'

export interface CreatePayoutInput {
  fundAccountId: string
  /** Integer rupees; converted to paise at the boundary. */
  amountRupees: number
  mode: RazorpayXPayoutMode
  /** Razorpay payout `purpose`; defaults to 'payout'. */
  purpose?: string
  /** Razorpay `reference_id`; the cron sets this to the payouts row id. */
  referenceId: string
  /** Sent as the `X-Payout-Idempotency` header; the cron keys it on payouts.id. */
  idempotencyKey: string
}

export interface CreatePayoutResult {
  payoutId: string
  status: string
  amountPaise: number
}

// ─────────────────── client-like seam (DI for the functions) ────────────────

/** Inputs the client layer receives — money already in paise (translated by the fn). */
export interface RazorpayXClientCreatePayoutInput {
  fundAccountId: string
  amountPaise: number
  mode: RazorpayXPayoutMode
  purpose: string
  referenceId: string
  idempotencyKey: string
}

/** Raw wire shapes returned by the client layer (a thin pass-through of Razorpay). */
export interface RazorpayXContactWire {
  id: string
  name?: string
  type?: string
}

export interface RazorpayXFundAccountWire {
  id: string
  contact_id?: string
  account_type?: string
}

export interface RazorpayXPayoutWire {
  id: string
  status: string
  amount: number
}

/**
 * The minimal surface the exported functions depend on. Tests inject a stub
 * implementing this; production injects the fetch-backed real client.
 */
export interface RazorpayXClientLike {
  createContact: (input: CreateContactInput) => Promise<RazorpayXContactWire>
  createFundAccount: (input: CreateFundAccountInput) => Promise<RazorpayXFundAccountWire>
  createPayout: (input: RazorpayXClientCreatePayoutInput) => Promise<RazorpayXPayoutWire>
}

// ───────────────────────── fetch-backed real client ─────────────────────────

interface FetchBackedClientOpts {
  keyId: string
  keySecret: string
  /** Source virtual account. Required only for createPayout; undefined throws there. */
  accountNumber: string | undefined
  /** Injectable for tests; defaults to the global fetch in production. */
  fetchImpl?: typeof fetch
}

interface RazorpayErrorEnvelope {
  statusCode?: number
  error?: { code?: string; description?: string }
}

/**
 * POST a JSON body to a Razorpay X endpoint with HTTP Basic auth, then
 * normalize any non-2xx into the RazorpayClientError envelope shape that the
 * shared `normalizeError` understands (so the status→code mapping stays a
 * single source of truth with the PG client).
 */
async function postJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  authHeader: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    })
  } catch (networkErr) {
    // No HTTP status (DNS/socket) → RAZORPAY_UNKNOWN via the shared mapper.
    throw normalizeError(networkErr)
  }

  if (!res.ok) {
    let envelope: RazorpayErrorEnvelope = { statusCode: res.status }
    try {
      const parsed = (await res.json()) as { error?: { code?: string; description?: string } }
      envelope = { statusCode: res.status, error: parsed?.error }
    } catch {
      // Body was not JSON; status alone drives the classification.
    }
    throw normalizeError(envelope)
  }

  return (await res.json()) as T
}

function basicAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
}

export function makeFetchBackedRazorpayXClient(
  opts: FetchBackedClientOpts,
): RazorpayXClientLike {
  const fetchImpl = opts.fetchImpl ?? fetch
  const authHeader = basicAuthHeader(opts.keyId, opts.keySecret)

  return {
    async createContact(input: CreateContactInput): Promise<RazorpayXContactWire> {
      const body: Record<string, unknown> = { name: input.name, type: input.type }
      if (input.referenceId !== undefined) body['reference_id'] = input.referenceId
      if (input.email !== undefined) body['email'] = input.email
      if (input.contact !== undefined) body['contact'] = input.contact
      return postJson<RazorpayXContactWire>(
        fetchImpl,
        `${RAZORPAYX_API_BASE}/contacts`,
        authHeader,
        body,
      )
    },

    async createFundAccount(
      input: CreateFundAccountInput,
    ): Promise<RazorpayXFundAccountWire> {
      const body: Record<string, unknown> = {
        contact_id: input.contactId,
        account_type: input.accountType,
      }
      if (input.accountType === 'bank_account') {
        if (!input.bankAccount) {
          throw new Error('createFundAccount: bankAccount is required for account_type bank_account')
        }
        body['bank_account'] = {
          name: input.bankAccount.name,
          ifsc: input.bankAccount.ifsc,
          account_number: input.bankAccount.accountNumber,
        }
      } else {
        if (!input.vpa) {
          throw new Error('createFundAccount: vpa is required for account_type vpa')
        }
        body['vpa'] = { address: input.vpa.address }
      }
      return postJson<RazorpayXFundAccountWire>(
        fetchImpl,
        `${RAZORPAYX_API_BASE}/fund_accounts`,
        authHeader,
        body,
      )
    },

    async createPayout(
      input: RazorpayXClientCreatePayoutInput,
    ): Promise<RazorpayXPayoutWire> {
      if (!opts.accountNumber) {
        throw new Error(
          'createPayout requires RAZORPAYX_ACCOUNT_NUMBER (the Razorpay X source virtual account) — it is unset',
        )
      }
      const body: Record<string, unknown> = {
        account_number: opts.accountNumber,
        fund_account_id: input.fundAccountId,
        amount: input.amountPaise,
        currency: 'INR',
        mode: input.mode,
        purpose: input.purpose,
        reference_id: input.referenceId,
        // Hold rather than hard-fail when the source account is briefly short;
        // the webhook (slice 06) still drives the terminal state.
        queue_if_low_balance: true,
      }
      return postJson<RazorpayXPayoutWire>(
        fetchImpl,
        `${RAZORPAYX_API_BASE}/payouts`,
        authHeader,
        body,
        { 'X-Payout-Idempotency': input.idempotencyKey },
      )
    },
  }
}

// ───────────────────────────── demo stub (non-prod) ─────────────────────────

/**
 * Deterministic fake-id stub for dev / E2E. Unreachable in production — the
 * factory throws there. Same spirit as razorpay-client's makeDemoStub.
 */
function makeDemoStub(): RazorpayXClientLike {
  let contactCounter = 0
  let fundAccountCounter = 0
  let payoutCounter = 0
  return {
    async createContact(input: CreateContactInput): Promise<RazorpayXContactWire> {
      contactCounter++
      return { id: `cont_demo_${Date.now()}_${contactCounter}`, name: input.name, type: input.type }
    },
    async createFundAccount(
      input: CreateFundAccountInput,
    ): Promise<RazorpayXFundAccountWire> {
      fundAccountCounter++
      return {
        id: `fa_demo_${Date.now()}_${fundAccountCounter}`,
        contact_id: input.contactId,
        account_type: input.accountType,
      }
    },
    async createPayout(
      input: RazorpayXClientCreatePayoutInput,
    ): Promise<RazorpayXPayoutWire> {
      payoutCounter++
      return {
        id: `pout_demo_${Date.now()}_${payoutCounter}`,
        status: 'processing',
        amount: input.amountPaise,
      }
    },
  }
}

// ───────────────────────────── factory + DI cache ───────────────────────────

let cachedClient: RazorpayXClientLike | null = null

interface GetClientOpts {
  keyId?: string
  keySecret?: string
}

/**
 * Lazily construct (or return the cached) Razorpay X client. Mirrors
 * razorpay-client's getRazorpayClient prod-throw posture exactly:
 *
 *  1. RAZORPAY_TEST_MODE=true → demo stub in non-prod, throw in production.
 *  2. else missing creds → throw in production, demo stub in non-prod.
 *  3. else → real fetch-backed client.
 *
 * Razorpay X reuses the PG key pair for auth; the source account number is
 * read lazily so its absence only blocks a REAL payout (build/test mode is
 * unaffected — see ADR-0016: it's a launch-blocking ops dep, not a build one).
 */
export function getRazorpayXClient(opts: GetClientOpts = {}): RazorpayXClientLike {
  if (cachedClient) return cachedClient

  if (process.env['RAZORPAY_TEST_MODE'] === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RAZORPAY_TEST_MODE must not be enabled in production')
    }
    cachedClient = makeDemoStub()
    return cachedClient
  }

  const keyId = opts.keyId ?? env.RAZORPAY_KEY_ID
  const keySecret = opts.keySecret ?? env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    // Never silently fall back to the demo stub in production: it fabricates fake
    // payout ids and would mark a Payout Batch "paid" against money that never
    // moved. Use process.env.NODE_ENV (not the frozen env module) for parity with
    // the RAZORPAY_TEST_MODE guard. Never echo secret values.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Razorpay credentials missing in production: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (the Razorpay X demo stub is non-prod only)',
      )
    }
    cachedClient = makeDemoStub()
    return cachedClient
  }

  cachedClient = makeFetchBackedRazorpayXClient({
    keyId,
    keySecret,
    accountNumber: env.RAZORPAYX_ACCOUNT_NUMBER,
  })
  return cachedClient
}

function assertNotProductionForTestHelpers(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Razorpay X test helpers (_resetRazorpayXClientForTests / _setRazorpayXClientForTests) must not be called in production',
    )
  }
}

/** Test-only — wipe the cached client. Throws in production. */
export function _resetRazorpayXClientForTests(): void {
  assertNotProductionForTestHelpers()
  cachedClient = null
}

/** Test-only — prime the cache with a stub. Throws in production. */
export function _setRazorpayXClientForTests(client: RazorpayXClientLike): void {
  assertNotProductionForTestHelpers()
  cachedClient = client
}

// ───────────────────────── exported functions (boundary) ────────────────────

interface FnClientOpts {
  client?: RazorpayXClientLike
}

function assertPayoutRupeeAmount(amountRupees: number): void {
  if (!Number.isInteger(amountRupees)) {
    throw new Error('amountRupees must be an integer (rupee precision)')
  }
  if (amountRupees < 0) {
    throw new Error('amountRupees must be non-negative')
  }
  if (amountRupees === 0) {
    throw new Error('amountRupees must be positive')
  }
}

export async function createContact(
  input: CreateContactInput,
  opts: FnClientOpts = {},
): Promise<CreateContactResult> {
  const client = opts.client ?? getRazorpayXClient()
  const contact = await client.createContact(input)
  return { contactId: contact.id }
}

export async function createFundAccount(
  input: CreateFundAccountInput,
  opts: FnClientOpts = {},
): Promise<CreateFundAccountResult> {
  const client = opts.client ?? getRazorpayXClient()
  const fundAccount = await client.createFundAccount(input)
  return { fundAccountId: fundAccount.id }
}

export async function createPayout(
  input: CreatePayoutInput,
  opts: FnClientOpts = {},
): Promise<CreatePayoutResult> {
  assertPayoutRupeeAmount(input.amountRupees)
  const client = opts.client ?? getRazorpayXClient()
  const amountPaise = input.amountRupees * 100

  const payout = await client.createPayout({
    fundAccountId: input.fundAccountId,
    amountPaise,
    mode: input.mode,
    purpose: input.purpose ?? 'payout',
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
  })

  return {
    payoutId: payout.id,
    status: payout.status,
    amountPaise: payout.amount,
  }
}
