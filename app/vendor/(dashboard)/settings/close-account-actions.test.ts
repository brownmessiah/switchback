import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { customerProfiles } from '@/db/schema/customer-profiles'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeCloseVendorAccount,
  getArchivableExperienceCount,
  getVendorClosureEligibility,
} from './close-account-core'

/**
 * Account-closure core logic (issue 06).
 *
 * Two eligibility gates per the locked block-until-clean decision:
 *   1. in-flight Bookings  (non-terminal states)            → BLOCKED
 *   2. unsettled Payout dues (completed + payoutState owed)  → BLOCKED
 * Clean → allowed. The transactional close reverts the user to a
 * Customer-only account (soft-archive, no money movement), archives the
 * Vendor's Experiences, and writes an audit row — all atomically.
 */

const VENDOR = 'u_close_vendor'
const CUSTOMER = 'u_close_customer'

// A vendor + customer + one published Experience + a future slot. Each test
// seeds its own Bookings on top of this baseline via the helper below.
async function seedBaseline(db: TestDB): Promise<{ experienceId: string; slotId: string }> {
  await db.insert(users).values([
    { id: VENDOR, email: 'close-vendor@test.com', name: 'Close Vendor' },
    { id: CUSTOMER, email: 'close-customer@test.com', name: 'Close Customer' },
  ])
  await db.insert(customerProfiles).values({ userId: CUSTOMER })
  await db.insert(vendorProfiles).values({
    userId: VENDOR,
    businessName: 'Closing Co',
    slug: 'closing-co',
    kycTier: 'business',
  })

  const [exp] = await db
    .insert(experiences)
    .values({
      vendorUserId: VENDOR,
      slug: 'rafting-rishikesh',
      title: 'Rafting in Rishikesh',
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '3000.00',
      pricePerPerson_3_5: '2800.00',
      pricePerPerson_6_plus: '2600.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'published',
    })
    .returning({ id: experiences.id })

  const future = new Date(Date.now() + 10 * 86_400_000)
  const [slot] = await db
    .insert(availabilitySlots)
    .values({
      experienceId: exp!.id,
      startAt: future,
      endAt: new Date(future.getTime() + 7_200_000),
      capacity: 8,
      capacityTaken: 0,
    })
    .returning({ id: availabilitySlots.id })

  return { experienceId: exp!.id, slotId: slot!.id }
}

const baseBooking = {
  customerUserId: CUSTOMER,
  participantCount: 2,
  paymentMode: 'full_upfront' as const,
  grossTotalSnapshot: '6000.00',
  pricePerParticipantSnapshot: '3000.00',
  pricingBasisSnapshot: 'per_person',
  commissionRateSnapshot: '20.00',
  commissionBasisSnapshot: 'vendor_base',
  cancellationPresetSnapshot: 'moderate',
  tdsAmountSnapshot: '6.00',
}

describe('getVendorClosureEligibility (issue 06 — block-until-clean)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let slotId: string

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
      sql`TRUNCATE TABLE audit_logs, bookings, availability_slots, experiences, vendor_profiles, customer_profiles, users CASCADE`,
    )
    const seeded = await seedBaseline(db)
    experienceId = seeded.experienceId
    slotId = seeded.slotId
  })

  it('allows closure when there are no in-flight Bookings and no unsettled dues', async () => {
    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.canClose).toBe(true)
    expect(result.inFlightCount).toBe(0)
    expect(result.unsettledDuesCount).toBe(0)
  })

  it('blocks closure when an in-flight (confirmed) Booking exists', async () => {
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId,
      state: 'confirmed',
    })

    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.canClose).toBe(false)
    expect(result.inFlightCount).toBe(1)
    expect(result.unsettledDuesCount).toBe(0)
  })

  it('counts every non-terminal Booking state as in-flight', async () => {
    for (const state of ['pending_payment', 'confirmed', 'awaiting_completion', 'disputed'] as const) {
      await db.insert(bookings).values({ ...baseBooking, experienceId, slotId, state })
    }

    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.inFlightCount).toBe(4)
    expect(result.canClose).toBe(false)
  })

  it('does NOT count terminal Bookings as in-flight', async () => {
    for (const state of [
      'cancelled_by_customer',
      'cancelled_by_vendor',
      'cancelled_post_experience',
      'no_show',
    ] as const) {
      await db.insert(bookings).values({ ...baseBooking, experienceId, slotId, state })
    }

    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.inFlightCount).toBe(0)
    expect(result.canClose).toBe(true)
  })

  it('blocks closure when a completed Booking has unsettled Payout dues (pending)', async () => {
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId,
      state: 'completed',
      payoutState: 'pending',
    })

    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.canClose).toBe(false)
    expect(result.inFlightCount).toBe(0)
    expect(result.unsettledDuesCount).toBe(1)
  })

  it('counts approved and held Payout states as unsettled dues', async () => {
    for (const payoutState of ['approved', 'held'] as const) {
      await db.insert(bookings).values({
        ...baseBooking,
        experienceId,
        slotId,
        state: 'completed',
        payoutState,
      })
    }

    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.unsettledDuesCount).toBe(2)
    expect(result.canClose).toBe(false)
  })

  it('does NOT count a completed Booking with a rejected Payout as a due', async () => {
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId,
      state: 'completed',
      payoutState: 'rejected',
    })

    const result = await getVendorClosureEligibility(db, VENDOR)

    expect(result.unsettledDuesCount).toBe(0)
    expect(result.canClose).toBe(true)
  })

  it('does NOT treat a non-completed Booking as an unsettled due (state=completed filter is essential)', async () => {
    // payoutState defaults to 'pending' on EVERY booking regardless of state —
    // a confirmed booking must not be counted as a payout due.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId,
      state: 'confirmed',
      payoutState: 'pending',
    })

    const result = await getVendorClosureEligibility(db, VENDOR)

    // It IS in-flight, but it is NOT an unsettled due.
    expect(result.inFlightCount).toBe(1)
    expect(result.unsettledDuesCount).toBe(0)
  })
})

describe('getArchivableExperienceCount (issue 06 — accurate archive count)', () => {
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
      sql`TRUNCATE TABLE audit_logs, bookings, availability_slots, experiences, vendor_profiles, customer_profiles, users CASCADE`,
    )
    await seedBaseline(db) // seeds VENDOR + one 'published' Experience
  })

  it('counts only Experiences that closure will archive (status != archived)', async () => {
    // Add a draft, a paused, and an already-archived Experience alongside the
    // baseline 'published' one. The count fed to the dialog copy must equal what
    // the archive UPDATE (ne status 'archived') actually flips: published + draft
    // + paused = 3, excluding the already-archived one.
    await db.insert(experiences).values([
      {
        vendorUserId: VENDOR,
        slug: 'draft-trek',
        title: 'Draft Trek',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1000.00',
        pricePerPerson_3_5: '1000.00',
        pricePerPerson_6_plus: '1000.00',
        regionSlug: 'manali',
        activitySlug: 'trekking',
        status: 'draft',
      },
      {
        vendorUserId: VENDOR,
        slug: 'paused-kayak',
        title: 'Paused Kayak',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1000.00',
        pricePerPerson_3_5: '1000.00',
        pricePerPerson_6_plus: '1000.00',
        regionSlug: 'goa',
        activitySlug: 'kayaking',
        status: 'paused',
      },
      {
        vendorUserId: VENDOR,
        slug: 'old-archived',
        title: 'Old Archived',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1000.00',
        pricePerPerson_3_5: '1000.00',
        pricePerPerson_6_plus: '1000.00',
        regionSlug: 'ladakh',
        activitySlug: 'trekking',
        status: 'archived',
      },
    ])

    const result = await getArchivableExperienceCount(db, VENDOR)

    expect(result).toBe(3)
  })

  it('returns 0 when every Experience is already archived', async () => {
    await db
      .update(experiences)
      .set({ status: 'archived' })
      .where(eq(experiences.vendorUserId, VENDOR))

    const result = await getArchivableExperienceCount(db, VENDOR)

    expect(result).toBe(0)
  })

  it('equals the audit payload experiencesArchivedCount after a real close', async () => {
    // Add a draft so the archivable count is > the single published baseline:
    // the pre-close count and the post-close archived count must agree.
    await db.insert(experiences).values({
      vendorUserId: VENDOR,
      slug: 'draft-two',
      title: 'Draft Two',
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000.00',
      pricePerPerson_3_5: '1000.00',
      pricePerPerson_6_plus: '1000.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'draft',
    })

    const countBefore = await getArchivableExperienceCount(db, VENDOR)
    expect(countBefore).toBe(2)

    await executeCloseVendorAccount(db, VENDOR, { confirmPhrase: 'CLOSE', reason: null })

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.profile.closed'))
    const payload = audit!.payload as Record<string, unknown>
    expect(payload.experiencesArchivedCount).toBe(countBefore)
  })
})

describe('executeCloseVendorAccount (issue 06 — transactional soft-close)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let slotId: string

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
      sql`TRUNCATE TABLE audit_logs, bookings, availability_slots, experiences, vendor_profiles, customer_profiles, users CASCADE`,
    )
    const seeded = await seedBaseline(db)
    experienceId = seeded.experienceId
    slotId = seeded.slotId
  })

  it('closes a clean vendor: sets closed_at + reason, archives Experiences, keeps Customer history', async () => {
    const result = await executeCloseVendorAccount(db, VENDOR, {
      confirmPhrase: 'CLOSE',
      reason: 'Moving abroad',
    })

    expect(result.ok).toBe(true)

    const [vendor] = await db
      .select({ closedAt: vendorProfiles.closedAt, closureReason: vendorProfiles.closureReason })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))
    expect(vendor!.closedAt).toBeInstanceOf(Date)
    expect(vendor!.closureReason).toBe('Moving abroad')

    // Experiences archived (not deleted).
    const [exp] = await db
      .select({ status: experiences.status })
      .from(experiences)
      .where(eq(experiences.id, experienceId))
    expect(exp!.status).toBe('archived')

    // Customer profile + user row preserved.
    const [cust] = await db
      .select({ userId: customerProfiles.userId })
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, CUSTOMER))
    expect(cust!.userId).toBe(CUSTOMER)
    const [vendorUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, VENDOR))
    expect(vendorUser!.id).toBe(VENDOR)
  })

  it('writes an audit row capturing who/when/dues-state/reverted at closure', async () => {
    await executeCloseVendorAccount(db, VENDOR, { confirmPhrase: 'CLOSE', reason: 'Done' })

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.profile.closed'))
    expect(audit).toBeDefined()
    expect(audit!.actorUserId).toBe(VENDOR)
    expect(audit!.entityType).toBe('vendor_profile')
    expect(audit!.entityId).toBe(VENDOR)
    const payload = audit!.payload as Record<string, unknown>
    expect(payload.reverted).toBe('vendor_to_customer')
    expect(payload.experiencesArchivedCount).toBe(1)
    expect(payload.inFlightCountAtClosure).toBe(0)
    expect(payload.unsettledDuesCountAtClosure).toBe(0)
    expect(payload.closureReason).toBe('Done')
    expect(typeof payload.closedAt).toBe('string')
    expect(typeof payload.retentionBasis).toBe('string')
  })

  it('does not archive Experiences that are already archived (idempotent count)', async () => {
    // Add a second, already-archived Experience.
    await db.insert(experiences).values({
      vendorUserId: VENDOR,
      slug: 'old-trek',
      title: 'Old Trek',
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000.00',
      pricePerPerson_3_5: '1000.00',
      pricePerPerson_6_plus: '1000.00',
      regionSlug: 'manali',
      activitySlug: 'trekking',
      status: 'archived',
    })

    await executeCloseVendorAccount(db, VENDOR, { confirmPhrase: 'CLOSE', reason: null })

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.profile.closed'))
    const payload = audit!.payload as Record<string, unknown>
    // Only the one published Experience flips; the pre-archived one is excluded.
    expect(payload.experiencesArchivedCount).toBe(1)
  })

  it('rejects closure when the typed phrase is not exactly CLOSE (server-side guard)', async () => {
    const result = await executeCloseVendorAccount(db, VENDOR, {
      confirmPhrase: 'close',
      reason: null,
    })

    expect(result.ok).toBe(false)

    // Nothing mutated.
    const [vendor] = await db
      .select({ closedAt: vendorProfiles.closedAt })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))
    expect(vendor!.closedAt).toBeNull()
    const [exp] = await db
      .select({ status: experiences.status })
      .from(experiences)
      .where(eq(experiences.id, experienceId))
    expect(exp!.status).toBe('published')
  })

  it('blocks closure with an in-flight Booking and writes no audit row', async () => {
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId,
      state: 'confirmed',
    })

    const result = await executeCloseVendorAccount(db, VENDOR, {
      confirmPhrase: 'CLOSE',
      reason: null,
    })

    expect(result.ok).toBe(false)

    const [vendor] = await db
      .select({ closedAt: vendorProfiles.closedAt })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))
    expect(vendor!.closedAt).toBeNull()
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.profile.closed'))
    expect(auditRows).toHaveLength(0)
  })

  it('blocks closure with unsettled Payout dues', async () => {
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId,
      state: 'completed',
      payoutState: 'approved',
    })

    const result = await executeCloseVendorAccount(db, VENDOR, {
      confirmPhrase: 'CLOSE',
      reason: null,
    })

    expect(result.ok).toBe(false)
    const [vendor] = await db
      .select({ closedAt: vendorProfiles.closedAt })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))
    expect(vendor!.closedAt).toBeNull()
  })

  it('rolls back ALL of {Experiences archive, closed_at, audit row} when a mid-transaction write fails (atomic)', async () => {
    // Inject a db whose transaction passes a tx that throws on the audit
    // insert — the LAST write inside the tx, AFTER the Experiences archive and
    // the vendor_profiles UPDATE have already executed. If the close is truly
    // one db.transaction, all three must roll back together.
    const failAuditInsert = () => {
      throw new Error('simulated mid-transaction audit failure')
    }
    const failingDb = {
      ...db,
      select: db.select.bind(db),
      // Throw on a top-level (non-tx) audit insert too, so this test still
      // detects non-atomicity if writeAuditLog is ever moved OUTSIDE the tx.
      insert: failAuditInsert,
      transaction: (cb: (tx: unknown) => Promise<unknown>) =>
        db.transaction((tx) => {
          const failingTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === 'insert') {
                // Audit row insert (writeAuditLog) → blow up mid-tx.
                return failAuditInsert
              }
              return Reflect.get(target, prop, receiver)
            },
          })
          return cb(failingTx)
        }),
    } as unknown as TestDB

    await expect(
      executeCloseVendorAccount(failingDb, VENDOR, {
        confirmPhrase: 'CLOSE',
        reason: 'Should roll back',
      }),
    ).rejects.toThrow(/simulated mid-transaction audit failure/)

    // (b) the Experience status is UNCHANGED (not 'archived')
    const [exp] = await db
      .select({ status: experiences.status })
      .from(experiences)
      .where(eq(experiences.id, experienceId))
    expect(exp!.status).toBe('published')

    // (c) vendor_profiles.closed_at is still NULL
    const [vendor] = await db
      .select({ closedAt: vendorProfiles.closedAt, closureReason: vendorProfiles.closureReason })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))
    expect(vendor!.closedAt).toBeNull()
    expect(vendor!.closureReason).toBeNull()

    // (d) NO audit row was written
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.profile.closed'))
    expect(auditRows).toHaveLength(0)
  })

  it('is idempotent: closing an already-closed vendor is a no-op success without a second audit row', async () => {
    await executeCloseVendorAccount(db, VENDOR, { confirmPhrase: 'CLOSE', reason: 'first' })
    const firstClose = await db
      .select({ closedAt: vendorProfiles.closedAt, reason: vendorProfiles.closureReason })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))

    const result = await executeCloseVendorAccount(db, VENDOR, {
      confirmPhrase: 'CLOSE',
      reason: 'second',
    })
    expect(result.ok).toBe(true)

    // Original closed_at + reason unchanged.
    const secondClose = await db
      .select({ closedAt: vendorProfiles.closedAt, reason: vendorProfiles.closureReason })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR))
    expect(secondClose[0]!.reason).toBe('first')
    expect(secondClose[0]!.closedAt!.getTime()).toBe(firstClose[0]!.closedAt!.getTime())

    // Exactly one audit row.
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.profile.closed'))
    expect(auditRows).toHaveLength(1)
  })
})
