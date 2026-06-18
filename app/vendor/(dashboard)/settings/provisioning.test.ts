import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorFundAccounts } from '@/db/schema/vendor-fund-accounts'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type {
  CreateContactInput,
  CreateFundAccountInput,
} from '@/lib/payments/razorpayx-client'
import { destinationFingerprint } from '@/lib/payments/payout-destination'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeUpdatePayoutMethod } from './settings-cores'

/**
 * Slice 03 — eager Razorpay X Contact + Fund Account provisioning hooked into
 * the payout-settings core (ADR-0016, 2026-06-18 amendment).
 *
 * A STUB X client is injected so tests never hit the network. We assert the
 * provisioning invariants directly from the persisted state:
 *  - Contact-once per Vendor (cached on vendor_profiles.razorpay_contact_id).
 *  - One Fund Account row per distinct destination, cooling-off = changedAt+7d.
 *  - Change-back reuses the retained row (no dup, cooling-off unchanged).
 *  - Idempotent under retry.
 *  - Razorpay X failure leaves the destination saved + surfaces a retriable error.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

interface StubCalls {
  contacts: CreateContactInput[]
  fundAccounts: CreateFundAccountInput[]
}

function makeStub(opts: { failContact?: boolean; failFundAccount?: boolean } = {}) {
  const calls: StubCalls = { contacts: [], fundAccounts: [] }
  let contactSeq = 0
  let fundAccountSeq = 0
  const deps = {
    async createContact(input: CreateContactInput) {
      calls.contacts.push(input)
      if (opts.failContact) throw new Error('razorpay X contact create failed')
      contactSeq++
      return { contactId: `cont_stub_${contactSeq}` }
    },
    async createFundAccount(input: CreateFundAccountInput) {
      calls.fundAccounts.push(input)
      if (opts.failFundAccount) throw new Error('razorpay X fund account create failed')
      fundAccountSeq++
      return { fundAccountId: `fa_stub_${fundAccountSeq}` }
    },
  }
  return { deps, calls }
}

describe('executeUpdatePayoutMethod — eager provisioning (slice 03)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_prov_vendor', email: 'prov-vendor@example.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_prov_vendor', businessName: 'Prov Adventures', slug: 'prov-adventures' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.delete(vendorFundAccounts)
    await db
      .update(vendorProfiles)
      .set({
        payoutMethod: null,
        payoutDestination: null,
        payoutDestinationChangedAt: null,
        razorpayContactId: null,
        updatedAt: new Date(),
      })
      .where(eq(vendorProfiles.userId, 'u_prov_vendor'))
  })

  it('creates exactly one Contact and caches its id on first destination set', async () => {
    const { deps, calls } = makeStub()
    const result = await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'vendor@upi' } },
      deps,
    )

    expect(result.ok).toBe(true)
    expect(calls.contacts).toHaveLength(1)
    expect(calls.contacts[0]).toMatchObject({
      name: 'Prov Adventures',
      referenceId: 'u_prov_vendor',
      type: 'vendor',
    })

    const [row] = await db
      .select({ contactId: vendorProfiles.razorpayContactId })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_prov_vendor'))
    expect(row.contactId).toBe('cont_stub_1')
  })

  it('does NOT create a second Contact on a subsequent destination change', async () => {
    const { deps, calls } = makeStub()
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'first@upi' } },
      deps,
    )
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'second@upi' } },
      deps,
    )

    expect(calls.contacts).toHaveLength(1)
    const [row] = await db
      .select({ contactId: vendorProfiles.razorpayContactId })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_prov_vendor'))
    expect(row.contactId).toBe('cont_stub_1')
  })

  it('creates one Fund Account row per distinct destination with cooling-off = changedAt + 7d', async () => {
    const { deps } = makeStub()
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'd1@upi' } },
      deps,
    )

    const fp1 = destinationFingerprint({ vpa: 'd1@upi' })
    const [row1] = await db
      .select()
      .from(vendorFundAccounts)
      .where(
        and(
          eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'),
          eq(vendorFundAccounts.destinationFingerprint, fp1),
        ),
      )
    expect(row1.razorpayFundAccountId).toBe('fa_stub_1')

    const [profile] = await db
      .select({ changedAt: vendorProfiles.payoutDestinationChangedAt })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_prov_vendor'))
    const expectedCoolingOff = profile.changedAt!.getTime() + SEVEN_DAYS_MS
    expect(row1.coolingOffUntil.getTime()).toBe(expectedCoolingOff)

    // Second, distinct destination → second row.
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'd2@upi' } },
      deps,
    )
    const allRows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'))
    expect(allRows).toHaveLength(2)
  })

  it('maps a bank_account destination to the X client bank shape', async () => {
    const { deps, calls } = makeStub()
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      {
        payoutMethod: 'bank_account',
        payoutDestination: {
          accountNumber: '1234567890',
          ifsc: 'HDFC0001234',
          accountHolderName: 'Prov Vendor',
        },
      },
      deps,
    )
    expect(calls.fundAccounts).toHaveLength(1)
    expect(calls.fundAccounts[0]).toEqual({
      contactId: 'cont_stub_1',
      accountType: 'bank_account',
      bankAccount: {
        name: 'Prov Vendor',
        ifsc: 'HDFC0001234',
        accountNumber: '1234567890',
      },
    })
  })

  it('maps a upi destination to the X client vpa shape', async () => {
    const { deps, calls } = makeStub()
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'vendor@upi' } },
      deps,
    )
    expect(calls.fundAccounts[0]).toEqual({
      contactId: 'cont_stub_1',
      accountType: 'vpa',
      vpa: { address: 'vendor@upi' },
    })
  })

  it('reuses the retained row on change-back — no duplicate, cooling-off unchanged', async () => {
    const { deps, calls } = makeStub()
    // d1 → d2 → back to d1.
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'd1@upi' } },
      deps,
    )
    const fp1 = destinationFingerprint({ vpa: 'd1@upi' })
    const [original] = await db
      .select()
      .from(vendorFundAccounts)
      .where(
        and(
          eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'),
          eq(vendorFundAccounts.destinationFingerprint, fp1),
        ),
      )

    await new Promise((r) => setTimeout(r, 5))
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'd2@upi' } },
      deps,
    )
    await new Promise((r) => setTimeout(r, 5))
    await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'd1@upi' } },
      deps,
    )

    // Two distinct destinations → exactly two rows (no dup for the re-set d1).
    const allRows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'))
    expect(allRows).toHaveLength(2)

    const [d1After] = await db
      .select()
      .from(vendorFundAccounts)
      .where(
        and(
          eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'),
          eq(vendorFundAccounts.destinationFingerprint, fp1),
        ),
      )
    // Same row, untouched cooling-off (a previously-validated destination is trusted).
    expect(d1After.id).toBe(original.id)
    expect(d1After.coolingOffUntil.getTime()).toBe(original.coolingOffUntil.getTime())
    expect(d1After.razorpayFundAccountId).toBe(original.razorpayFundAccountId)

    // The X fund-account API was called only for d1 and d2 (not the re-set d1).
    expect(calls.fundAccounts).toHaveLength(2)
  })

  it('is idempotent under retry — re-running with the same destination creates no second Contact and no second Fund Account', async () => {
    const { deps, calls } = makeStub()
    const input = {
      payoutMethod: 'upi' as const,
      payoutDestination: { vpa: 'same@upi' },
    }
    await executeUpdatePayoutMethod(db, 'u_prov_vendor', input, deps)
    await executeUpdatePayoutMethod(db, 'u_prov_vendor', input, deps)

    expect(calls.contacts).toHaveLength(1)
    expect(calls.fundAccounts).toHaveLength(1)
    const rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'))
    expect(rows).toHaveLength(1)
  })

  it('on Contact failure: destination is saved, error surfaced as retriable, no contact cached, no fund-account row', async () => {
    const { deps } = makeStub({ failContact: true })
    const result = await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'vendor@upi' } },
      deps,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.destinationSaved).toBe(true)
      expect(result.error).toBeTruthy()
    }

    // Destination IS persisted.
    const [profile] = await db
      .select({
        method: vendorProfiles.payoutMethod,
        dest: vendorProfiles.payoutDestination,
        contactId: vendorProfiles.razorpayContactId,
      })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_prov_vendor'))
    expect(profile.method).toBe('upi')
    expect(profile.dest).toEqual({ vpa: 'vendor@upi' })
    // No half-applied contact id cached.
    expect(profile.contactId).toBeNull()

    // No fund-account row written.
    const rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'))
    expect(rows).toEqual([])
  })

  it('on Fund Account failure: contact cached, destination saved, error surfaced, no fund-account row; retry succeeds', async () => {
    // First attempt: fund-account create fails (but contact succeeds).
    const failing = makeStub({ failFundAccount: true })
    const result = await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'vendor@upi' } },
      failing.deps,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.destinationSaved).toBe(true)
    }

    // Contact WAS created + cached (it succeeded); no fund-account row.
    const [afterFail] = await db
      .select({ contactId: vendorProfiles.razorpayContactId })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_prov_vendor'))
    expect(afterFail.contactId).toBe('cont_stub_1')
    let rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'))
    expect(rows).toEqual([])

    // Retry with a healthy client: reuses cached contact, provisions the fund account.
    const healthy = makeStub()
    const retry = await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'vendor@upi' } },
      healthy.deps,
    )
    expect(retry.ok).toBe(true)
    // No second contact created on retry (cached id reused).
    expect(healthy.calls.contacts).toHaveLength(0)
    rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_prov_vendor'))
    expect(rows).toHaveLength(1)
  })

  it('surfaces a retriable error when the vendor profile is missing at provisioning time', async () => {
    // The destination UPDATE matches no row, but provisioning then reads the
    // vendor and must fail cleanly (no contact created, no fund-account row).
    const { deps, calls } = makeStub()
    const result = await executeUpdatePayoutMethod(
      db,
      'u_does_not_exist',
      { payoutMethod: 'upi', payoutDestination: { vpa: 'ghost@upi' } },
      deps,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.destinationSaved).toBe(true)
      expect(result.error).toMatch(/vendor profile not found/i)
    }
    expect(calls.contacts).toHaveLength(0)
    expect(calls.fundAccounts).toHaveLength(0)
  })

  it('still rejects invalid input before any provisioning call', async () => {
    const { deps, calls } = makeStub()
    const result = await executeUpdatePayoutMethod(
      db,
      'u_prov_vendor',
      { payoutMethod: 'upi', payoutDestination: {} },
      deps,
    )
    expect(result.ok).toBe(false)
    expect(calls.contacts).toHaveLength(0)
    expect(calls.fundAccounts).toHaveLength(0)
  })
})
