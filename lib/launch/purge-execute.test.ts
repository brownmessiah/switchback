import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { blogPosts } from '@/db/schema/blog-posts'
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
import { executePurgePlan } from './purge-execute'
import { SEED_ADMIN_USER_ID } from './seed-data-registry'

/**
 * Purge execution (launch-readiness 06).
 *
 * Execution consumes a plan built by the planner rather than re-deriving
 * targets, so what the operator approved in the dry-run is exactly what
 * runs. The catastrophic failure mode is deleting real data, so most of
 * these tests are survival assertions, not deletion assertions.
 */

async function addUser(db: TestDB, id: string, email: string) {
  await db.insert(users).values({ id, email, name: id })
}

async function addVendorWithExperience(
  db: TestDB,
  userId: string,
  email: string,
  slug: string,
): Promise<string> {
  await addUser(db, userId, email)
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

async function addBooking(
  db: TestDB,
  experienceId: string,
  customerUserId: string,
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
      state: 'confirmed',
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

describe('executePurgePlan', () => {
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
    await db.delete(availabilitySlots)
    await db.delete(blogPosts)
    await db.delete(experiences)
    await db.delete(vendorProfiles)
    await db.delete(adminProfiles)
    await db.delete(promoCodes)
    await db.delete(regionClosures)
    await db.delete(users)
  })

  it('deletes exactly what the plan predicted', async () => {
    const expId = await addVendorWithExperience(
      db,
      'u_seed_v1',
      'v1@seed.outvers.dev',
      'seeded-trip',
    )
    await addUser(db, 'u_seed_cust', 'cust@seed.outvers.dev')
    await addBooking(db, expId, 'u_seed_cust')

    const plan = await buildPurgePlan(db)
    const predicted = Object.fromEntries(
      plan.entries.filter((e) => e.rowCount > 0).map((e) => [e.table, e.rowCount]),
    )

    const result = await executePurgePlan(db, plan)

    expect(result.deleted).toEqual(predicted)
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await db.select().from(experiences)).toHaveLength(0)
    expect(await db.select().from(bookings)).toHaveLength(0)
  })

  // THE test. Deleting real data is the irreversible failure.
  it('leaves a real Vendor, Experience, Booking and Customer completely untouched', async () => {
    await addVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')
    await addUser(db, 'u_seed_cust', 'cust@seed.outvers.dev')

    const realExpId = await addVendorWithExperience(
      db,
      'real_vendor',
      'realvendor@gmail.com',
      'real-trip',
    )
    await addUser(db, 'real_cust', 'realcustomer@gmail.com')
    const realBookingId = await addBooking(db, realExpId, 'real_cust')

    const plan = await buildPurgePlan(db)
    expect(plan.safeToExecute).toBe(true)
    await executePurgePlan(db, plan)

    const survivingUsers = await db.select({ id: users.id }).from(users)
    expect(survivingUsers.map((u) => u.id).sort()).toEqual(['real_cust', 'real_vendor'])

    const survivingExps = await db.select({ id: experiences.id }).from(experiences)
    expect(survivingExps).toHaveLength(1)
    expect(survivingExps[0]!.id).toBe(realExpId)

    const survivingBookings = await db.select({ id: bookings.id }).from(bookings)
    expect(survivingBookings).toHaveLength(1)
    expect(survivingBookings[0]!.id).toBe(realBookingId)

    expect(await db.select().from(vendorProfiles)).toHaveLength(1)
  })

  it('preserves the blog corpus and its author', async () => {
    await addUser(db, SEED_ADMIN_USER_ID, 'admin@seed.outvers.dev')
    await db.insert(adminProfiles).values({
      userId: SEED_ADMIN_USER_ID,
      permissions: ['*'],
    })
    await db.insert(blogPosts).values({
      slug: 'monsoon-trekking-guide',
      title: 'Monsoon trekking guide',
      content: 'body',
      category: 'guides',
      authorAdminId: SEED_ADMIN_USER_ID,
      status: 'published',
    })
    await addVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')

    const plan = await buildPurgePlan(db)
    await executePurgePlan(db, plan)

    const posts = await db.select().from(blogPosts)
    expect(posts).toHaveLength(1)

    // The author must survive too — blog_posts.author_admin_id is RESTRICT,
    // so a purge that removed them would have failed outright anyway.
    const admin = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, SEED_ADMIN_USER_ID))
    expect(admin).toHaveLength(1)

    const profile = await db
      .select({ permissions: adminProfiles.permissions })
      .from(adminProfiles)
      .where(eq(adminProfiles.userId, SEED_ADMIN_USER_ID))
    expect(profile[0]?.permissions).toEqual(['*'])
  })

  it('deletes rows reachable only through a parent id (payments via booking_id)', async () => {
    const expId = await addVendorWithExperience(
      db,
      'u_seed_v1',
      'v1@seed.outvers.dev',
      'seeded-trip',
    )
    await addUser(db, 'u_seed_cust', 'cust@seed.outvers.dev')
    const bookingId = await addBooking(db, expId, 'u_seed_cust')
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_exec_1',
      amount: '500.00',
      captureTrigger: 'booking_create',
    })

    const plan = await buildPurgePlan(db)
    await executePurgePlan(db, plan)

    expect(await db.select().from(payments)).toHaveLength(0)
    expect(await db.select().from(bookings)).toHaveLength(0)
  })

  it('completes without any foreign-key violation across the full ordered run', async () => {
    const expId = await addVendorWithExperience(
      db,
      'u_seed_v1',
      'v1@seed.outvers.dev',
      'seeded-trip',
    )
    await addUser(db, 'u_seed_cust', 'cust@seed.outvers.dev')
    const bookingId = await addBooking(db, expId, 'u_seed_cust')
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_exec_2',
      amount: '500.00',
      captureTrigger: 'booking_create',
    })
    await db.insert(reviews).values({
      bookingId,
      experienceId: expId,
      customerUserId: 'u_seed_cust',
      vendorUserId: 'u_seed_v1',
      rating: 5,
    })

    const plan = await buildPurgePlan(db)
    await expect(executePurgePlan(db, plan)).resolves.toBeDefined()
  })

  it('purges content-keyed rows unreachable by traversal', async () => {
    await db.insert(promoCodes).values([
      { code: 'WELCOME500', creditAmount: '500.00' },
      { code: 'REALPROMO', creditAmount: '100.00' },
    ])
    await db.insert(regionClosures).values([
      {
        regionSlug: 'lonavala',
        startAt: new Date('2026-07-20T00:00:00Z'),
        endAt: new Date('2026-08-10T00:00:00Z'),
        reason: 'Monsoon',
        source: 'admin',
      },
    ])

    const plan = await buildPurgePlan(db)
    await executePurgePlan(db, plan)

    const remainingPromos = await db.select({ code: promoCodes.code }).from(promoCodes)
    expect(remainingPromos.map((p) => p.code)).toEqual(['REALPROMO'])
    expect(await db.select().from(regionClosures)).toHaveLength(0)
  })

  it('is a safe no-op when re-run against an already-purged database', async () => {
    await addVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')

    await executePurgePlan(db, await buildPurgePlan(db))

    const secondPlan = await buildPurgePlan(db)
    expect(secondPlan.totalRows).toBe(0)
    const secondResult = await executePurgePlan(db, secondPlan)
    expect(secondResult.totalDeleted).toBe(0)
  })

  it('REFUSES to execute a plan carrying blockers', async () => {
    const expId = await addVendorWithExperience(
      db,
      'u_seed_v1',
      'v1@seed.outvers.dev',
      'seeded-trip',
    )
    await addUser(db, 'real_cust', 'realcustomer@gmail.com')
    await addBooking(db, expId, 'real_cust')

    const plan = await buildPurgePlan(db)
    expect(plan.safeToExecute).toBe(false)

    await expect(executePurgePlan(db, plan)).rejects.toThrow(/blocker/i)

    // And nothing was deleted.
    expect(await db.select().from(experiences)).toHaveLength(1)
    expect(await db.select().from(users)).toHaveLength(2)
  })

  it('returns a summary suitable for the operational record', async () => {
    await addVendorWithExperience(db, 'u_seed_v1', 'v1@seed.outvers.dev', 'seeded-trip')

    const plan = await buildPurgePlan(db)
    const result = await executePurgePlan(db, plan)

    expect(result.totalDeleted).toBeGreaterThan(0)
    expect(result.deleted['users']).toBe(1)
    expect(result.deleted['experiences']).toBe(1)
    expect(Object.keys(result.deleted).length).toBeGreaterThan(0)
  })
})
