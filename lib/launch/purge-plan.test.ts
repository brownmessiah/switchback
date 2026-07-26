import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { promoCodes } from '@/db/schema/promo-codes'
import { regionClosures } from '@/db/schema/region-closures'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { buildPurgePlan } from './purge-plan'
import { SEED_ADMIN_USER_ID } from './seed-data-registry'

/**
 * The purge planner (launch-readiness 05) — read-only.
 *
 * The catastrophic failure mode is deleting REAL data. Issue 05 proposed
 * testing that a real-looking Vendor is not *targeted*; that is the easy
 * direction and it is not where the danger lives. The danger is real rows
 * POINTING AT seed rows:
 *   - bookings.experience_id is RESTRICT → a real Customer's Booking of a
 *     seeded Experience aborts the whole transaction, AFTER approval;
 *   - reviews.experience_id is CASCADE   → purging a seeded Experience
 *     silently destroys a real Customer's Review, with no row in the plan.
 * So the planner must run a referential pre-flight and REFUSE, listing
 * the offending rows, rather than deleting or cascading through them.
 */

async function seedUser(db: TestDB, id: string, email: string) {
  await db.insert(users).values({ id, email, name: id })
}

async function seedVendorWithExperience(
  db: TestDB,
  userId: string,
  email: string,
  slug: string,
): Promise<string> {
  await seedUser(db, userId, email)
  await db.insert(vendorProfiles).values({
    userId,
    businessName: `${slug} Co`,
    slug: `${slug}-co`,
  })
  const [row] = await db
    .insert(experiences)
    .values({
      vendorUserId: userId,
      title: slug,
      slug,
      status: 'published',
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000.00',
      pricePerPerson_3_5: '900.00',
      pricePerPerson_6_plus: '800.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
    .returning({ id: experiences.id })
  return row!.id
}


/** Insert a Booking with every NOT NULL snapshot column the schema requires. */
async function addBooking(
  db: TestDB,
  experienceId: string,
  customerUserId: string,
  state: 'confirmed' | 'completed',
): Promise<string> {
  const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
  const [slot] = await db
    .insert(availabilitySlots)
    .values({ experienceId, startAt, endAt, capacity: 8 })
    .returning({ id: availabilitySlots.id })
  const [row] = await db
    .insert(bookings)
    .values({
      customerUserId,
      experienceId,
      slotId: slot!.id,
      participantCount: 2,
      paymentMode: 'full_upfront',
      state,
      grossTotalSnapshot: '2000.00',
      pricePerParticipantSnapshot: '1000.00',
      pricingBasisSnapshot: 'experience_bracket:1_2',
      commissionRateSnapshot: '15.00',
      commissionBasisSnapshot: 'vendor_default',
      cancellationPresetSnapshot: 'moderate',
      tdsAmountSnapshot: '2.00',
      gstRateOnCommissionSnapshot: '18.00',
      vendorPanSnapshot: 'ABCDE1234F',
      vendorIsResidentSnapshot: true,
    })
    .returning({ id: bookings.id })
  return row!.id
}

function entryFor(plan: Awaited<ReturnType<typeof buildPurgePlan>>, table: string) {
  return plan.entries.find((e) => e.table === table)
}

describe('buildPurgePlan', () => {
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
    await db.delete(payments)
    await db.delete(reviews)
    await db.delete(bookings)
    await db.delete(experiences)
    await db.delete(vendorProfiles)
    await db.delete(adminProfiles)
    await db.delete(promoCodes)
    await db.delete(regionClosures)
    await db.delete(users)
  })

  it('is read-only — building a plan deletes nothing', async () => {
    await seedVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')

    await buildPurgePlan(db)

    expect(await db.select().from(experiences)).toHaveLength(1)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('targets seeded Users and the Experiences that hang off them', async () => {
    await seedVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')

    const plan = await buildPurgePlan(db)

    expect(entryFor(plan, 'users')?.rowCount).toBe(1)
    expect(entryFor(plan, 'experiences')?.rowCount).toBe(1)
    expect(entryFor(plan, 'vendor_profiles')?.rowCount).toBe(1)
    expect(plan.blockers).toEqual([])
  })

  // The prefix trap: u_cat_* users are seeded but do NOT carry the
  // u_seed_ prefix the PRD named. Email is what identifies them.
  it('targets every seed id prefix, not just u_seed_', async () => {
    await seedUser(db, 'u_cat_vendor_01', 'cat1@seed.outvers.dev')
    await seedUser(db, 'u_enr_cust_01', 'enr1@seed.outvers.dev')
    await seedUser(db, 'u_demo_cust_01', 'demo1@seed.outvers.dev')
    await seedUser(db, 'u_tg_host_a', 'tg1@seed.outvers.dev')

    const plan = await buildPurgePlan(db)

    expect(entryFor(plan, 'users')?.rowCount).toBe(4)
  })

  it('never targets a real Vendor, their Experience, or a real Customer', async () => {
    await seedVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')
    await seedVendorWithExperience(
      db,
      'real_vendor_uuid',
      'realvendor@gmail.com',
      'real-trip',
    )
    await seedUser(db, 'real_cust_uuid', 'realcustomer@gmail.com')

    const plan = await buildPurgePlan(db)

    expect(entryFor(plan, 'users')?.rowCount).toBe(1)
    expect(entryFor(plan, 'experiences')?.rowCount).toBe(1)
    expect(plan.blockers).toEqual([])
  })

  it('is idempotent — a plan against an already-purged database is empty', async () => {
    await seedUser(db, 'real_cust_uuid', 'realcustomer@gmail.com')

    const plan = await buildPurgePlan(db)

    expect(plan.totalRows).toBe(0)
    expect(plan.entries.every((e) => e.rowCount === 0)).toBe(true)
  })

  it('preserves the seeded Admin and records the exclusion', async () => {
    await seedUser(db, SEED_ADMIN_USER_ID, 'admin@seed.outvers.dev')
    await db.insert(adminProfiles).values({
      userId: SEED_ADMIN_USER_ID,
      permissions: ['*'],
    })
    await seedUser(db, 'u_seed_subadmin', 'subadmin@seed.outvers.dev')

    const plan = await buildPurgePlan(db)

    // The sub-admin dies as an ordinary seed User; the admin survives.
    expect(entryFor(plan, 'users')?.rowCount).toBe(1)
    expect(plan.exclusions.some((e) => e.reason.includes('admin'))).toBe(true)
  })

  describe('referential pre-flight — the catastrophic cases', () => {
    it('BLOCKS when a real Customer has a Booking on a seeded Experience', async () => {
      const expId = await seedVendorWithExperience(
        db,
        'u_seed_v1',
        'v1@seed.outvers.dev',
        'seeded-trip',
      )
      await seedUser(db, 'real_cust_uuid', 'realcustomer@gmail.com')
      await addBooking(db, expId, 'real_cust_uuid', 'confirmed')

      const plan = await buildPurgePlan(db)

      expect(plan.blockers.length).toBeGreaterThan(0)
      const blocker = plan.blockers.find((b) => b.table === 'bookings')
      expect(blocker).toBeDefined()
      expect(blocker!.rowCount).toBe(1)
      expect(plan.safeToExecute).toBe(false)
    })

    it('BLOCKS when a real Customer has reviewed a seeded Experience (silent CASCADE)', async () => {
      const expId = await seedVendorWithExperience(
        db,
        'u_seed_v1',
        'v1@seed.outvers.dev',
        'seeded-trip',
      )
      await seedUser(db, 'real_cust_uuid', 'realcustomer@gmail.com')
      const bookingId = await addBooking(db, expId, 'real_cust_uuid', 'completed')
      await db.insert(reviews).values({
        bookingId,
        experienceId: expId,
        customerUserId: 'real_cust_uuid',
        vendorUserId: 'u_seed_v1',
        rating: 5,
      })

      const plan = await buildPurgePlan(db)

      expect(plan.safeToExecute).toBe(false)
      expect(plan.blockers.some((b) => b.table === 'reviews')).toBe(true)
    })

    it('does NOT block on a seeded Customer booking a seeded Experience', async () => {
      const expId = await seedVendorWithExperience(
        db,
        'u_seed_v1',
        'v1@seed.outvers.dev',
        'seeded-trip',
      )
      await seedUser(db, 'u_seed_cust', 'cust@seed.outvers.dev')
      await addBooking(db, expId, 'u_seed_cust', 'confirmed')

      const plan = await buildPurgePlan(db)

      expect(plan.blockers).toEqual([])
      expect(plan.safeToExecute).toBe(true)
      expect(entryFor(plan, 'bookings')?.rowCount).toBe(1)
    })
  })

  describe('content-keyed rows unreachable by user traversal', () => {
    it('targets the seeded promo codes', async () => {
      await db.insert(promoCodes).values([
        { code: 'WELCOME500', creditAmount: '500.00' },
        { code: 'REALPROMO', creditAmount: '100.00' },
      ])

      const plan = await buildPurgePlan(db)

      expect(entryFor(plan, 'promo_codes')?.rowCount).toBe(1)
    })

    it('targets the seeded region closures', async () => {
      await db.insert(regionClosures).values([
        {
          regionSlug: 'lonavala',
          startAt: new Date('2026-07-20T00:00:00Z'),
          endAt: new Date('2026-08-10T00:00:00Z'),
          reason: 'Monsoon',
          source: 'admin',
        },
        {
          regionSlug: 'rishikesh',
          startAt: new Date('2026-07-20T00:00:00Z'),
          endAt: new Date('2026-08-10T00:00:00Z'),
          reason: 'Real closure',
          source: 'admin',
        },
      ])

      const plan = await buildPurgePlan(db)

      expect(entryFor(plan, 'region_closures')?.rowCount).toBe(1)
    })
  })

  /**
   * REGRESSION (caught by running the dry-run against a fully seeded
   * database, not by any earlier test): `payments` carries no user or
   * experience column — it hangs off `booking_id`. A traversal that
   * probes only user/experience columns reported ZERO payments while 51
   * existed. Because `payments.booking_id` is RESTRICT, the dry-run
   * would have under-reported and execution would have aborted
   * mid-transaction, after the operator approved the counts.
   */
  it('counts rows reachable only through a parent id, not just user/experience', async () => {
    const expId = await seedVendorWithExperience(
      db,
      'u_seed_v1',
      'v1@seed.outvers.dev',
      'seeded-trip',
    )
    await seedUser(db, 'u_seed_cust', 'cust@seed.outvers.dev')
    const bookingId = await addBooking(db, expId, 'u_seed_cust', 'confirmed')
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_seed_regression_1',
      amount: '500.00',
      captureTrigger: 'booking_create',
    })

    const plan = await buildPurgePlan(db)

    expect(entryFor(plan, 'payments')?.rowCount).toBe(1)
  })

  it('orders entries FK-safely: children before their RESTRICT parents', async () => {
    const plan = await buildPurgePlan(db)
    const idx = (t: string) => plan.entries.findIndex((e) => e.table === t)

    expect(idx('payments')).toBeLessThan(idx('bookings'))
    expect(idx('reviews')).toBeLessThan(idx('bookings'))
    expect(idx('bookings')).toBeLessThan(idx('experiences'))
    expect(idx('experiences')).toBeLessThan(idx('vendor_profiles'))
    expect(idx('vendor_profiles')).toBeLessThan(idx('users'))
    expect(idx('media_assets')).toBeLessThan(idx('users'))
  })

  it('never plans a protected table', async () => {
    const plan = await buildPurgePlan(db)
    const planned = plan.entries.map((e) => e.table)

    expect(planned).not.toContain('blog_posts')
    expect(planned).not.toContain('audit_logs')
    expect(planned).not.toContain('newsletter_subscribers')
  })
})
