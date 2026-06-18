import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { users } from './users'
import { vendorFundAccounts } from './vendor-fund-accounts'
import { vendorProfiles } from './vendor-profiles'

/**
 * Slice 03 — `vendor_fund_accounts` (ADR-0016, 2026-06-18 amendment).
 *
 * History-retaining table keyed by (vendor, destination fingerprint). The
 * unique index dedupes a destination per Vendor while RETAINING rows for
 * distinct destinations, so a Booking that snapshotted an older destination
 * still resolves to its provisioned Fund Account.
 */
describe('vendor_fund_accounts schema (ADR-0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_fa_vendor', email: 'fa-vendor@example.com' },
      { id: 'u_fa_other', email: 'fa-other@example.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_fa_vendor', businessName: 'FA Adventures', slug: 'fa-adventures' },
      { userId: 'u_fa_other', businessName: 'FA Other', slug: 'fa-other' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.delete(vendorFundAccounts)
  })

  it('migration replays clean — the table exists and is selectable', async () => {
    const rows = await db.select().from(vendorFundAccounts)
    expect(rows).toEqual([])
  })

  it('persists a fund account row with cooling-off and timestamps', async () => {
    const coolingOffUntil = new Date('2026-07-01T00:00:00Z')
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_fa_vendor',
      destinationFingerprint: 'fp_one',
      razorpayFundAccountId: 'fa_real_1',
      coolingOffUntil,
    })

    const [row] = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_fa_vendor'))

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.razorpayFundAccountId).toBe('fa_real_1')
    expect(row.coolingOffUntil.getTime()).toBe(coolingOffUntil.getTime())
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('retains distinct destinations for the same vendor', async () => {
    await db.insert(vendorFundAccounts).values([
      {
        vendorUserId: 'u_fa_vendor',
        destinationFingerprint: 'fp_a',
        razorpayFundAccountId: 'fa_a',
        coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
      },
      {
        vendorUserId: 'u_fa_vendor',
        destinationFingerprint: 'fp_b',
        razorpayFundAccountId: 'fa_b',
        coolingOffUntil: new Date('2026-07-02T00:00:00Z'),
      },
    ])

    const rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_fa_vendor'))

    expect(rows).toHaveLength(2)
  })

  it('rejects a duplicate (vendor, fingerprint) via the unique index', async () => {
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_fa_vendor',
      destinationFingerprint: 'fp_dup',
      razorpayFundAccountId: 'fa_first',
      coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
    })

    await expect(
      db.insert(vendorFundAccounts).values({
        vendorUserId: 'u_fa_vendor',
        destinationFingerprint: 'fp_dup',
        razorpayFundAccountId: 'fa_second',
        coolingOffUntil: new Date('2026-07-05T00:00:00Z'),
      }),
    ).rejects.toThrow()
  })

  it('allows the same fingerprint for two different vendors', async () => {
    await db.insert(vendorFundAccounts).values([
      {
        vendorUserId: 'u_fa_vendor',
        destinationFingerprint: 'fp_shared',
        razorpayFundAccountId: 'fa_v',
        coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
      },
      {
        vendorUserId: 'u_fa_other',
        destinationFingerprint: 'fp_shared',
        razorpayFundAccountId: 'fa_o',
        coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
      },
    ])

    const rows = await db.select().from(vendorFundAccounts)
    expect(rows).toHaveLength(2)
  })

  it('onConflictDoNothing makes a concurrent duplicate insert a no-op', async () => {
    const values = {
      vendorUserId: 'u_fa_vendor',
      destinationFingerprint: 'fp_conflict',
      razorpayFundAccountId: 'fa_x',
      coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
    }
    await db.insert(vendorFundAccounts).values(values)
    await db
      .insert(vendorFundAccounts)
      .values({ ...values, razorpayFundAccountId: 'fa_y' })
      .onConflictDoNothing({
        target: [vendorFundAccounts.vendorUserId, vendorFundAccounts.destinationFingerprint],
      })

    const rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(
        and(
          eq(vendorFundAccounts.vendorUserId, 'u_fa_vendor'),
          eq(vendorFundAccounts.destinationFingerprint, 'fp_conflict'),
        ),
      )
    expect(rows).toHaveLength(1)
    // The first write wins; the conflicting insert was discarded.
    expect(rows[0].razorpayFundAccountId).toBe('fa_x')
  })

  it('adds the razorpay_contact_id column to vendor_profiles (nullable)', async () => {
    const [before] = await db
      .select({ contactId: vendorProfiles.razorpayContactId })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_fa_vendor'))
    expect(before.contactId).toBeNull()

    await db
      .update(vendorProfiles)
      .set({ razorpayContactId: 'cont_123' })
      .where(eq(vendorProfiles.userId, 'u_fa_vendor'))

    const [after] = await db
      .select({ contactId: vendorProfiles.razorpayContactId })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_fa_vendor'))
    expect(after.contactId).toBe('cont_123')
  })

  it('cascades deletes from users', async () => {
    await db.insert(users).values({ id: 'u_fa_temp', email: 'fa-temp@example.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_fa_temp',
      businessName: 'Temp',
      slug: 'fa-temp',
    })
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_fa_temp',
      destinationFingerprint: 'fp_temp',
      razorpayFundAccountId: 'fa_temp',
      coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
    })

    await db.delete(users).where(eq(users.id, 'u_fa_temp'))

    const rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_fa_temp'))
    expect(rows).toEqual([])
  })

  it('keyed by vendor index supports lookups', async () => {
    // Sanity: the by-vendor index path returns rows for the vendor.
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_fa_vendor',
      destinationFingerprint: 'fp_idx',
      razorpayFundAccountId: 'fa_idx',
      coolingOffUntil: new Date('2026-07-01T00:00:00Z'),
    })
    const rows = await db
      .select()
      .from(vendorFundAccounts)
      .where(eq(vendorFundAccounts.vendorUserId, 'u_fa_vendor'))
    expect(rows).toHaveLength(1)
  })
})
