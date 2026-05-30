import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadMoneyKpis } from './loaders'

// ── Seed helpers ───────────────────────────────────────────────────

async function seedCustomer(db: TestDB, id = 'cust_dash_1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, name: 'Customer' })
  return id
}

async function seedVendor(db: TestDB, id = 'vendor_dash_1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, name: 'Vendor' })
  await db.insert(vendorProfiles).values({
    userId: id,
    businessName: 'Adventure Co',
    slug: `adventure-co-${id}`,
    kycTier: 'identity',
    commissionRate: '20.00',
  })
  return id
}

async function seedExperience(db: TestDB, vendorId: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(experiences).values({
    id,
    vendorUserId: vendorId,
    slug: `exp-${id.slice(0, 8)}`,
    title: 'Kayaking',
    status: 'published',
    cancellationPreset: 'flexible',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '2000.00',
    pricePerPerson_3_5: '1500.00',
    pricePerPerson_6_plus: '1200.00',
    regionSlug: 'rishikesh',
    activitySlug: 'kayaking',
  })
  return id
}

async function seedSlot(db: TestDB, experienceId: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(availabilitySlots).values({
    id,
    experienceId,
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T12:00:00Z'),
    capacity: 10,
    capacityTaken: 2,
  })
  return id
}

async function seedBooking(
  db: TestDB,
  customerId: string,
  experienceId: string,
  slotId: string,
  overrides: {
    grossTotal?: string
    commissionRate?: string
    gstRate?: string
    tds?: string
    tcs?: string
    state?:
      | 'confirmed'
      | 'awaiting_completion'
      | 'completed'
      | 'disputed'
      | 'cancelled_by_customer'
    payoutState?: 'pending' | 'approved' | 'rejected' | 'held'
  } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(bookings).values({
    id,
    customerUserId: customerId,
    experienceId,
    slotId,
    participantCount: 2,
    state: overrides.state ?? 'completed',
    payoutState: overrides.payoutState ?? 'pending',
    paymentMode: 'full_upfront',
    grossTotalSnapshot: overrides.grossTotal ?? '10000.00',
    pricePerParticipantSnapshot: '5000.00',
    pricingBasisSnapshot: '1_2',
    commissionRateSnapshot: overrides.commissionRate ?? '20.00',
    commissionBasisSnapshot: 'vendor_base_rate',
    cancellationPresetSnapshot: 'flexible',
    tdsAmountSnapshot: overrides.tds ?? '10.00',
    tcsAmountSnapshot: overrides.tcs ?? '50.00',
    gstRateOnCommissionSnapshot: overrides.gstRate ?? '18.00',
    vendorIsResidentSnapshot: true,
  })
  return id
}

async function seedRefundRequest(
  db: TestDB,
  bookingId: string,
  requestedBy: string,
  overrides: { amount?: string; state?: 'pending' | 'credited' } = {},
): Promise<void> {
  await db.insert(refundRequests).values({
    bookingId,
    requestedByUserId: requestedBy,
    reason: 'inside_policy_cancellation',
    destination: 'refund_balance',
    state: overrides.state ?? 'pending',
    amount: overrides.amount ?? '1500.00',
    cancellationPresetSnapshot: 'flexible',
    policyWindowBasisSnapshot: 'free_window',
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe('loadMoneyKpis', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE refund_requests, payments, bookings, availability_slots, experiences, vendor_profiles, users CASCADE`,
    )
  })

  it('returns all-zero figures when there is no money data', async () => {
    const kpis = await loadMoneyKpis(db)
    expect(kpis).toEqual({
      pendingPayouts: 0,
      refundLiability: 0,
      commission: 0,
      gstTdsDue: 0,
      netRevenue: 0,
    })
  })

  it('refundLiability sums only PENDING refund request amounts', async () => {
    const custId = await seedCustomer(db)
    const vendorId = await seedVendor(db)
    const expId = await seedExperience(db, vendorId)
    const slotId = await seedSlot(db, expId)
    const b1 = await seedBooking(db, custId, expId, slotId)
    const b2 = await seedBooking(db, custId, expId, slotId)

    await seedRefundRequest(db, b1, custId, { amount: '1500.00', state: 'pending' })
    // A credited (resolved) refund must NOT count toward live liability.
    await seedRefundRequest(db, b2, custId, { amount: '999.00', state: 'credited' })

    const kpis = await loadMoneyKpis(db)
    expect(kpis.refundLiability).toBe(1500)
  })

  it('computes payout/commission/GST-TDS/net over the completed+payout-pending population', async () => {
    const custId = await seedCustomer(db)
    const vendorId = await seedVendor(db)
    const expId = await seedExperience(db, vendorId)
    const slotId = await seedSlot(db, expId)

    // In-scope: completed + payout pending.
    //   commission      = floor(10000 * 20 / 100)      = 2000
    //   gstOnCommission = floor(2000 * 18 / 100)        = 360
    //   netPayout       = 10000 - 2000 - 360 - 10 - 50  = 7580  (owed to Vendor)
    //   gstTdsDue       = 360 + 10 + 50                 = 420   (statutory, remitted out)
    //   netRevenue      = commission - gstOnCommission  = 1640  (platform-RETAINED)
    //                     — excludes TDS+TCS (the Vendor's taxes, ADR-0016) and
    //                       nets out the GST the platform must remit on commission.
    await seedBooking(db, custId, expId, slotId, {
      grossTotal: '10000.00',
      commissionRate: '20.00',
      gstRate: '18.00',
      tds: '10.00',
      tcs: '50.00',
      state: 'completed',
      payoutState: 'pending',
    })

    // Out of scope (not yet completed) — must be excluded.
    await seedBooking(db, custId, expId, slotId, {
      grossTotal: '99999.00',
      state: 'confirmed',
      payoutState: 'pending',
    })
    // Out of scope (already approved for disbursement) — must be excluded.
    await seedBooking(db, custId, expId, slotId, {
      grossTotal: '88888.00',
      state: 'completed',
      payoutState: 'approved',
    })

    const kpis = await loadMoneyKpis(db)
    expect(kpis.pendingPayouts).toBe(7580)
    expect(kpis.commission).toBe(2000)
    expect(kpis.gstTdsDue).toBe(420)
    // Net revenue is the platform-retained take: commission minus the GST the
    // platform must remit on that commission. NOT commission + statutory dues.
    expect(kpis.netRevenue).toBe(1640)
  })

  it('netRevenue is platform-retained only — it excludes the statutory GST/TDS/TCS dues', async () => {
    const custId = await seedCustomer(db)
    const vendorId = await seedVendor(db)
    const expId = await seedExperience(db, vendorId)
    const slotId = await seedSlot(db, expId)

    await seedBooking(db, custId, expId, slotId, {
      grossTotal: '10000.00',
      commissionRate: '20.00',
      gstRate: '18.00',
      tds: '10.00',
      tcs: '50.00',
      state: 'completed',
      payoutState: 'pending',
    })

    const kpis = await loadMoneyKpis(db)
    // Regression guard (ADR-0016): TDS §194-O and TCS §52 are the Vendor's
    // taxes and GST-on-commission is the platform's output-tax LIABILITY —
    // none are platform income. Net revenue must therefore never bundle the
    // statutory dues, i.e. it must NOT equal `commission + gstTdsDue`.
    expect(kpis.netRevenue).not.toBe(kpis.commission + kpis.gstTdsDue)
    expect(kpis.netRevenue).toBeLessThan(kpis.commission)
    expect(kpis.netRevenue).toBe(1640)
  })

  it('aggregates money figures across multiple in-scope bookings', async () => {
    const custId = await seedCustomer(db)
    const vendorId = await seedVendor(db)
    const expId = await seedExperience(db, vendorId)
    const slotId = await seedSlot(db, expId)

    // Two identical in-scope bookings → every figure doubles.
    await seedBooking(db, custId, expId, slotId, { state: 'completed', payoutState: 'pending' })
    await seedBooking(db, custId, expId, slotId, { state: 'completed', payoutState: 'pending' })

    const kpis = await loadMoneyKpis(db)
    expect(kpis.pendingPayouts).toBe(7580 * 2)
    expect(kpis.commission).toBe(2000 * 2)
    expect(kpis.gstTdsDue).toBe(420 * 2)
    expect(kpis.netRevenue).toBe(1640 * 2)
  })
})
