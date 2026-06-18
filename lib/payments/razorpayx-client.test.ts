import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RazorpayClientError } from './razorpay-client'
import {
  _resetRazorpayXClientForTests,
  _setRazorpayXClientForTests,
  createContact,
  createFundAccount,
  createPayout,
  getRazorpayXClient,
  makeFetchBackedRazorpayXClient,
  type RazorpayXClientLike,
} from './razorpayx-client'

/**
 * Razorpay X choke-point per ADR-0016 (2026-06-18 amendment, D8). Mirrors
 * the razorpay-client.ts discipline: DI of an SDK-like, error normalization
 * into the RazorpayClientError vocabulary, rupee→paise at the boundary, and a
 * demo stub that is unreachable in production.
 *
 * Two DI seams:
 *  - the three exported functions accept `{ client }` so tests inject a stub
 *    that records the typed inputs (no network);
 *  - the real fetch-backed client accepts an injectable `fetchImpl` so tests
 *    assert the EXACT wire request (url, method, headers, body) without a
 *    network call.
 */

// ───────────────────────── DI-stub seam (typed inputs) ─────────────────────

function fakeClientOk(): RazorpayXClientLike {
  return {
    createContact: vi.fn(async (input) => ({
      id: 'cont_TEST123',
      name: input.name,
      type: input.type,
    })),
    createFundAccount: vi.fn(async (input) => ({
      id: 'fa_TEST123',
      contact_id: input.contactId,
      account_type: input.accountType,
    })),
    createPayout: vi.fn(async (input) => ({
      id: 'pout_TEST123',
      status: 'processing',
      amount: input.amountPaise,
    })),
  }
}

describe('createContact', () => {
  it('passes the typed contact through to the client and returns the contact id', async () => {
    const client = fakeClientOk()
    const result = await createContact(
      { name: 'Acme Treks', type: 'vendor', referenceId: 'vnd_1', email: 'ops@acme.test' },
      { client },
    )

    expect(client.createContact).toHaveBeenCalledTimes(1)
    expect(client.createContact).toHaveBeenCalledWith({
      name: 'Acme Treks',
      type: 'vendor',
      referenceId: 'vnd_1',
      email: 'ops@acme.test',
    })
    expect(result.contactId).toBe('cont_TEST123')
  })

  it('omits optional fields when not supplied', async () => {
    const client = fakeClientOk()
    await createContact({ name: 'Acme', type: 'vendor' }, { client })
    expect(client.createContact).toHaveBeenCalledWith({ name: 'Acme', type: 'vendor' })
  })
})

describe('createFundAccount', () => {
  it('passes a bank-account fund account through and returns the fund-account id', async () => {
    const client = fakeClientOk()
    const result = await createFundAccount(
      {
        contactId: 'cont_1',
        accountType: 'bank_account',
        bankAccount: { name: 'Acme Treks', ifsc: 'HDFC0000001', accountNumber: '1234567890' },
      },
      { client },
    )

    expect(client.createFundAccount).toHaveBeenCalledWith({
      contactId: 'cont_1',
      accountType: 'bank_account',
      bankAccount: { name: 'Acme Treks', ifsc: 'HDFC0000001', accountNumber: '1234567890' },
    })
    expect(result.fundAccountId).toBe('fa_TEST123')
  })

  it('passes a VPA fund account through and returns the fund-account id', async () => {
    const client = fakeClientOk()
    const result = await createFundAccount(
      { contactId: 'cont_1', accountType: 'vpa', vpa: { address: 'acme@upi' } },
      { client },
    )

    expect(client.createFundAccount).toHaveBeenCalledWith({
      contactId: 'cont_1',
      accountType: 'vpa',
      vpa: { address: 'acme@upi' },
    })
    expect(result.fundAccountId).toBe('fa_TEST123')
  })
})

describe('createPayout', () => {
  it('converts rupees to paise at the boundary and returns the payout id + status + paise', async () => {
    const client = fakeClientOk()
    const result = await createPayout(
      {
        fundAccountId: 'fa_1',
        amountRupees: 2500,
        mode: 'IMPS',
        referenceId: 'po_1',
        idempotencyKey: 'po_1',
      },
      { client },
    )

    expect(client.createPayout).toHaveBeenCalledTimes(1)
    expect(client.createPayout).toHaveBeenCalledWith({
      fundAccountId: 'fa_1',
      amountPaise: 250_000,
      mode: 'IMPS',
      purpose: 'payout',
      referenceId: 'po_1',
      idempotencyKey: 'po_1',
    })
    expect(result.payoutId).toBe('pout_TEST123')
    expect(result.status).toBe('processing')
    expect(result.amountPaise).toBe(250_000)
  })

  it('honours an explicit purpose override', async () => {
    const client = fakeClientOk()
    await createPayout(
      {
        fundAccountId: 'fa_1',
        amountRupees: 100,
        mode: 'NEFT',
        purpose: 'vendor_advance',
        referenceId: 'po_2',
        idempotencyKey: 'po_2',
      },
      { client },
    )
    expect(client.createPayout).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'vendor_advance', amountPaise: 10_000 }),
    )
  })

  it('rejects non-integer rupee amounts', async () => {
    const client = fakeClientOk()
    await expect(
      createPayout(
        { fundAccountId: 'fa_1', amountRupees: 100.5, mode: 'IMPS', referenceId: 'p', idempotencyKey: 'p' },
        { client },
      ),
    ).rejects.toThrow(/integer/i)
    expect(client.createPayout).not.toHaveBeenCalled()
  })

  it('rejects negative rupee amounts', async () => {
    const client = fakeClientOk()
    await expect(
      createPayout(
        { fundAccountId: 'fa_1', amountRupees: -1, mode: 'IMPS', referenceId: 'p', idempotencyKey: 'p' },
        { client },
      ),
    ).rejects.toThrow(/non-negative/i)
  })

  it('rejects zero rupee amounts (a Payout always moves money)', async () => {
    const client = fakeClientOk()
    await expect(
      createPayout(
        { fundAccountId: 'fa_1', amountRupees: 0, mode: 'IMPS', referenceId: 'p', idempotencyKey: 'p' },
        { client },
      ),
    ).rejects.toThrow(/positive/i)
  })
})

// ─────────────────── fetch-backed wire contract (exact request) ─────────────

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function recordingFetch(
  response: { status: number; json: unknown },
): { fetchImpl: typeof fetch; captured: () => CapturedRequest } {
  let captured: CapturedRequest | undefined
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value
    })
    captured = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() {
        return response.json
      },
      async text() {
        return JSON.stringify(response.json)
      },
    } as Response
  }) as unknown as typeof fetch

  return {
    fetchImpl,
    captured: () => {
      if (!captured) throw new Error('fetch was not called')
      return captured
    },
  }
}

const WIRE_CREDS = {
  keyId: 'rzp_test_keyid',
  keySecret: 'rzp_test_secret',
  accountNumber: '2323230000000000',
}

describe('fetch-backed client — exact wire contract', () => {
  it('createContact POSTs to /v1/contacts with Basic auth and the contact body', async () => {
    const { fetchImpl, captured } = recordingFetch({
      status: 200,
      json: { id: 'cont_WIRE', name: 'Acme', type: 'vendor' },
    })
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl })

    const res = await client.createContact({
      name: 'Acme',
      type: 'vendor',
      referenceId: 'vnd_1',
      email: 'ops@acme.test',
    })

    const req = captured()
    expect(req.url).toBe('https://api.razorpay.com/v1/contacts')
    expect(req.method).toBe('POST')
    expect(req.headers['authorization']).toBe(
      `Basic ${Buffer.from('rzp_test_keyid:rzp_test_secret').toString('base64')}`,
    )
    expect(req.headers['content-type']).toMatch(/application\/json/)
    expect(req.body).toEqual({
      name: 'Acme',
      type: 'vendor',
      reference_id: 'vnd_1',
      email: 'ops@acme.test',
    })
    expect(res.id).toBe('cont_WIRE')
  })

  it('createFundAccount POSTs a bank_account fund account in Razorpay wire shape', async () => {
    const { fetchImpl, captured } = recordingFetch({
      status: 200,
      json: { id: 'fa_WIRE', contact_id: 'cont_1', account_type: 'bank_account' },
    })
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl })

    await client.createFundAccount({
      contactId: 'cont_1',
      accountType: 'bank_account',
      bankAccount: { name: 'Acme', ifsc: 'HDFC0000001', accountNumber: '1234567890' },
    })

    const req = captured()
    expect(req.url).toBe('https://api.razorpay.com/v1/fund_accounts')
    expect(req.body).toEqual({
      contact_id: 'cont_1',
      account_type: 'bank_account',
      bank_account: { name: 'Acme', ifsc: 'HDFC0000001', account_number: '1234567890' },
    })
  })

  it('createFundAccount POSTs a vpa fund account in Razorpay wire shape', async () => {
    const { fetchImpl, captured } = recordingFetch({
      status: 200,
      json: { id: 'fa_WIRE', contact_id: 'cont_1', account_type: 'vpa' },
    })
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl })

    await client.createFundAccount({
      contactId: 'cont_1',
      accountType: 'vpa',
      vpa: { address: 'acme@upi' },
    })

    const req = captured()
    expect(req.url).toBe('https://api.razorpay.com/v1/fund_accounts')
    expect(req.body).toEqual({
      contact_id: 'cont_1',
      account_type: 'vpa',
      vpa: { address: 'acme@upi' },
    })
  })

  it('createPayout sends account_number, currency INR, reference_id, and the X-Payout-Idempotency header', async () => {
    const { fetchImpl, captured } = recordingFetch({
      status: 200,
      json: { id: 'pout_WIRE', status: 'processing', amount: 250_000 },
    })
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl })

    const res = await client.createPayout({
      fundAccountId: 'fa_1',
      amountPaise: 250_000,
      mode: 'IMPS',
      purpose: 'payout',
      referenceId: 'po_1',
      idempotencyKey: 'po_1',
    })

    const req = captured()
    expect(req.url).toBe('https://api.razorpay.com/v1/payouts')
    expect(req.method).toBe('POST')
    expect(req.headers['x-payout-idempotency']).toBe('po_1')
    expect(req.headers['authorization']).toBe(
      `Basic ${Buffer.from('rzp_test_keyid:rzp_test_secret').toString('base64')}`,
    )
    expect(req.body).toEqual({
      account_number: '2323230000000000',
      fund_account_id: 'fa_1',
      amount: 250_000,
      currency: 'INR',
      mode: 'IMPS',
      purpose: 'payout',
      reference_id: 'po_1',
      queue_if_low_balance: true,
    })
    expect(res.id).toBe('pout_WIRE')
    expect(res.status).toBe('processing')
  })

  it('createFundAccount throws when account_type is bank_account but bankAccount is missing', async () => {
    const { fetchImpl } = recordingFetch({ status: 200, json: {} })
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl })
    await expect(
      client.createFundAccount({ contactId: 'cont_1', accountType: 'bank_account' }),
    ).rejects.toThrow(/bankAccount is required/)
  })

  it('createFundAccount throws when account_type is vpa but vpa is missing', async () => {
    const { fetchImpl } = recordingFetch({ status: 200, json: {} })
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl })
    await expect(
      client.createFundAccount({ contactId: 'cont_1', accountType: 'vpa' }),
    ).rejects.toThrow(/vpa is required/)
  })

  it('createPayout throws a clear error when the source account number is absent', async () => {
    const { fetchImpl } = recordingFetch({ status: 200, json: {} })
    const client = makeFetchBackedRazorpayXClient({
      keyId: WIRE_CREDS.keyId,
      keySecret: WIRE_CREDS.keySecret,
      accountNumber: undefined,
      fetchImpl,
    })
    await expect(
      client.createPayout({
        fundAccountId: 'fa_1',
        amountPaise: 100,
        mode: 'IMPS',
        purpose: 'payout',
        referenceId: 'po_1',
        idempotencyKey: 'po_1',
      }),
    ).rejects.toThrow(/RAZORPAYX_ACCOUNT_NUMBER/)
  })
})

// ───────────────────────── error normalization ─────────────────────────────

function fetchReturning(status: number, json: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return json
      },
      async text() {
        return JSON.stringify(json)
      },
    }) as Response) as unknown as typeof fetch
}

describe('error normalization (shared RazorpayClientError vocabulary)', () => {
  async function expectContactError(status: number, json: unknown): Promise<RazorpayClientError> {
    const client = makeFetchBackedRazorpayXClient({
      ...WIRE_CREDS,
      fetchImpl: fetchReturning(status, json),
    })
    try {
      await client.createContact({ name: 'Acme', type: 'vendor' })
      throw new Error('expected createContact to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayClientError)
      return err as RazorpayClientError
    }
  }

  it('maps 5xx to UPSTREAM_5XX (retryable)', async () => {
    const e = await expectContactError(502, { error: { code: 'SERVER_ERROR', description: 'bad gateway' } })
    expect(e.code).toBe('UPSTREAM_5XX')
    expect(e.retryable).toBe(true)
    expect(e.upstreamStatus).toBe(502)
  })

  it('maps 429 to RAZORPAY_RATE_LIMITED (retryable)', async () => {
    const e = await expectContactError(429, { error: { code: 'RATE_LIMIT', description: 'slow down' } })
    expect(e.code).toBe('RAZORPAY_RATE_LIMITED')
    expect(e.retryable).toBe(true)
  })

  it('maps 401 to RAZORPAY_AUTH (non-retryable) and never leaks the key in the message', async () => {
    const e = await expectContactError(401, {
      error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed for rzp_live_LEAK' },
    })
    expect(e.code).toBe('RAZORPAY_AUTH')
    expect(e.retryable).toBe(false)
    expect(e.message).not.toMatch(/rzp_live_/)
  })

  it('maps 404 to RAZORPAY_NOT_FOUND (non-retryable)', async () => {
    const e = await expectContactError(404, { error: { code: 'NOT_FOUND', description: 'missing' } })
    expect(e.code).toBe('RAZORPAY_NOT_FOUND')
    expect(e.retryable).toBe(false)
  })

  it('maps a generic 4xx to RAZORPAY_BAD_REQUEST (non-retryable)', async () => {
    const e = await expectContactError(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'bad ifsc' } })
    expect(e.code).toBe('RAZORPAY_BAD_REQUEST')
    expect(e.retryable).toBe(false)
    expect(e.message).toMatch(/bad ifsc/)
  })

  it('maps a network failure (no status) to RAZORPAY_UNKNOWN (non-retryable)', async () => {
    const client = makeFetchBackedRazorpayXClient({
      ...WIRE_CREDS,
      fetchImpl: (async () => {
        throw new Error('socket hang up')
      }) as unknown as typeof fetch,
    })
    try {
      await client.createContact({ name: 'Acme', type: 'vendor' })
      throw new Error('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('RAZORPAY_UNKNOWN')
      expect((err as RazorpayClientError).message).toMatch(/socket hang up/)
    }
  })

  it('classifies a non-JSON error body (e.g. an HTML 502 from a proxy) by status alone', async () => {
    const htmlErrorFetch = (async () =>
      ({
        ok: false,
        status: 502,
        async json() {
          throw new Error('Unexpected token < in JSON')
        },
        async text() {
          return '<html>502 Bad Gateway</html>'
        },
      }) as unknown as Response) as unknown as typeof fetch
    const client = makeFetchBackedRazorpayXClient({ ...WIRE_CREDS, fetchImpl: htmlErrorFetch })
    try {
      await client.createContact({ name: 'Acme', type: 'vendor' })
      throw new Error('expected throw')
    } catch (err) {
      expect((err as RazorpayClientError).code).toBe('UPSTREAM_5XX')
      expect((err as RazorpayClientError).retryable).toBe(true)
      expect((err as RazorpayClientError).upstreamStatus).toBe(502)
    }
  })

  it('propagates the normalized error through createPayout too', async () => {
    const client = makeFetchBackedRazorpayXClient({
      ...WIRE_CREDS,
      fetchImpl: fetchReturning(503, { error: { code: 'SERVER_ERROR', description: 'down' } }),
    })
    await expect(
      createPayout(
        { fundAccountId: 'fa_1', amountRupees: 100, mode: 'IMPS', referenceId: 'p', idempotencyKey: 'p' },
        { client },
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_5XX', retryable: true })
  })
})

// ───────────────────────── factory: prod-throw + test-mode stub ─────────────

describe('getRazorpayXClient factory', () => {
  const originalTestMode = process.env['RAZORPAY_TEST_MODE']

  beforeEach(() => {
    delete process.env['RAZORPAY_TEST_MODE']
    _resetRazorpayXClientForTests()
  })

  afterEach(() => {
    if (originalTestMode === undefined) {
      delete process.env['RAZORPAY_TEST_MODE']
    } else {
      process.env['RAZORPAY_TEST_MODE'] = originalTestMode
    }
    _resetRazorpayXClientForTests()
  })

  it('returns the demo stub in non-prod when creds are missing', async () => {
    const client = getRazorpayXClient({ keyId: undefined, keySecret: undefined })
    const contact = await client.createContact({ name: 'Acme', type: 'vendor' })
    expect(contact.id).toMatch(/^cont_demo_/)
    const fa = await client.createFundAccount({
      contactId: contact.id,
      accountType: 'vpa',
      vpa: { address: 'acme@upi' },
    })
    expect(fa.id).toMatch(/^fa_demo_/)
    const pout = await client.createPayout({
      fundAccountId: fa.id,
      amountPaise: 10_000,
      mode: 'IMPS',
      purpose: 'payout',
      referenceId: 'po_1',
      idempotencyKey: 'po_1',
    })
    expect(pout.id).toMatch(/^pout_demo_/)
    expect(pout.status).toBe('processing')
    expect(pout.amount).toBe(10_000)
  })

  it('returns the demo stub in non-prod when RAZORPAY_TEST_MODE=true despite real creds', async () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const client = getRazorpayXClient({ keyId: 'rzp_live_real', keySecret: 'real_secret' })
    const contact = await client.createContact({ name: 'Acme', type: 'vendor' })
    expect(contact.id).toMatch(/^cont_demo_/)
  })

  it('throws in production when creds are missing (no silent stub, no fake payout ids)', () => {
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      expect(() =>
        getRazorpayXClient({ keyId: undefined, keySecret: undefined }),
      ).toThrow(/RAZORPAY_KEY_ID/)
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayXClientForTests()
    }
  })

  it('throws in production when RAZORPAY_TEST_MODE=true (test-mode is non-prod only)', () => {
    process.env['RAZORPAY_TEST_MODE'] = 'true'
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      expect(() => getRazorpayXClient()).toThrow(/RAZORPAY_TEST_MODE must not be enabled in production/)
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayXClientForTests()
    }
  })

  it('production WITH real creds constructs a fetch-backed client (no throw)', () => {
    const envRecord = process.env as Record<string, string | undefined>
    const origNodeEnv = envRecord['NODE_ENV']
    envRecord['NODE_ENV'] = 'production'
    try {
      const client = getRazorpayXClient({ keyId: 'rzp_live_real', keySecret: 'real_secret' })
      expect(client.createContact).toBeTypeOf('function')
      expect(client.createPayout).toBeTypeOf('function')
    } finally {
      envRecord['NODE_ENV'] = origNodeEnv
      _resetRazorpayXClientForTests()
    }
  })

  it('caches the constructed client across calls', () => {
    const first = getRazorpayXClient({ keyId: 'rzp_test', keySecret: 'secret' })
    const second = getRazorpayXClient()
    expect(second).toBe(first)
  })

  it('the three exported functions fall back to the cached client when opts.client is omitted', async () => {
    _setRazorpayXClientForTests(fakeClientOk())
    const contact = await createContact({ name: 'Acme', type: 'vendor' })
    expect(contact.contactId).toBe('cont_TEST123')
  })

  it('the test helpers are callable in non-prod (env.NODE_ENV is "test")', () => {
    // Mirrors razorpay-client: the helpers key off the build-time frozen
    // env.NODE_ENV (which is 'test' under vitest), so they stay callable here
    // while throwing in a real production build. We assert the non-prod arm.
    expect(() => _setRazorpayXClientForTests(fakeClientOk())).not.toThrow()
    expect(() => _resetRazorpayXClientForTests()).not.toThrow()
  })
})
