import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'

import { users } from '@/db/schema/users'
import { vendorFundAccounts } from '@/db/schema/vendor-fund-accounts'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { destinationFingerprint } from './payout-destination'
import { resolveFundAccount } from './fund-account-resolver'

/**
 * Fund Account resolver per ADR-0016 (2026-06-18 amendment).
 *
 * Maps a Booking's snapshotted destination → the provisioned Razorpay X
 * `razorpayFundAccountId`, by reading `vendor_fund_accounts` keyed on
 * (vendorUserId, destinationFingerprint). The fingerprint is the SAME shared
 * hash slice 03 used, so a Booking's snapshot matches the row that was
 * provisioned for that destination.
 *
 * Routing (never provisions inline):
 *   no row                      → admin_queue, reason 'missing'  (covers legacy too)
 *   coolingOffUntil > now       → admin_queue, reason 'cooling_off'
 *   else                        → ok, fundAccountId
 */
describe('resolveFundAccount (ADR-0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const VPA = { vpa: 'vendor@upi' }
  const FINGERPRINT = destinationFingerprint(VPA)
  const NOW = new Date('2026-06-18T11:30:00.000Z')

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE vendor_fund_accounts CASCADE`)
  })

  it('returns ok + fundAccountId when a cooled-off Fund Account exists', async () => {
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      razorpayFundAccountId: 'fa_live_123',
      // cooled off yesterday → eligible
      coolingOffUntil: new Date(NOW.getTime() - 86_400_000),
    })

    const result = await resolveFundAccount(db, {
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      now: NOW,
    })

    expect(result).toEqual({ status: 'ok', fundAccountId: 'fa_live_123' })
  })

  it('routes to the admin queue with reason "missing" when there is no row', async () => {
    const result = await resolveFundAccount(db, {
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      now: NOW,
    })
    expect(result).toEqual({ status: 'admin_queue', reason: 'missing' })
  })

  it('routes to the admin queue with reason "cooling_off" when still cooling off', async () => {
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      razorpayFundAccountId: 'fa_live_123',
      // cools off tomorrow → not yet eligible
      coolingOffUntil: new Date(NOW.getTime() + 86_400_000),
    })

    const result = await resolveFundAccount(db, {
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      now: NOW,
    })
    expect(result).toEqual({ status: 'admin_queue', reason: 'cooling_off' })
  })

  it('treats coolingOffUntil exactly at now as cooled off (ok)', async () => {
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      razorpayFundAccountId: 'fa_live_123',
      coolingOffUntil: NOW,
    })

    const result = await resolveFundAccount(db, {
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      now: NOW,
    })
    expect(result).toEqual({ status: 'ok', fundAccountId: 'fa_live_123' })
  })

  it('does not match a different vendor sharing the same destination fingerprint', async () => {
    await db.insert(users).values({ id: 'u_other', email: 'o@example.com' })
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_other',
      destinationFingerprint: FINGERPRINT,
      razorpayFundAccountId: 'fa_other',
      coolingOffUntil: new Date(NOW.getTime() - 86_400_000),
    })

    const result = await resolveFundAccount(db, {
      vendorUserId: 'u_v',
      destinationFingerprint: FINGERPRINT,
      now: NOW,
    })
    expect(result).toEqual({ status: 'admin_queue', reason: 'missing' })
  })
})
