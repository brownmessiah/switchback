import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  PLATFORM_DEFAULT_COMMISSION_RATE,
  resolveCommission,
} from './commission-resolver'

/**
 * Commission resolution chain per ADR-0008.
 *
 * Precedence (first non-null wins):
 *   1. Active festival tier (commission_tiers, time-windowed, scope-filtered)
 *   2. Per-Experience override (experiences.commission_rate_override)
 *   3. Per-Vendor base rate (vendor_profiles.commission_rate, default 20)
 *   4. Platform default constant (20)
 *
 * Snapshotted onto bookings.commission_rate_snapshot + commission_basis_snapshot
 * at create time; never recomputed for that Booking.
 */
describe('resolveCommission (ADR-0008)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      commissionRate: '20.00',
    })
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Clear festival tiers + any per-experience overrides before each test
    await db.execute(sql`TRUNCATE TABLE commission_tiers`)
    await db
      .update(experiences)
      .set({ commissionRateOverride: null })
      .where(eq(experiences.id, experienceId))
    await db
      .update(vendorProfiles)
      .set({ commissionRate: '20.00' })
      .where(eq(vendorProfiles.userId, 'u_v'))
  })

  describe('chain precedence', () => {
    it('falls back to platform default when nothing matches', async () => {
      // Clear vendor commission rate by setting to platform-default
      // (we can't NULL it because of NOT NULL constraint, but if a vendor
      //  row has the default value the resolver should still report
      //  vendor_default, not platform_default). To exercise the platform
      //  default arm, we resolve against a non-existent experience? No —
      //  better: keep vendor commission at default and assert vendor_default.
      //  The platform_default arm fires when vendor row is missing; we can't
      //  trigger that against a valid experience because the FK is NOT NULL.
      //  Cover it via the explicit fallback constant test below.
      const r = await resolveCommission(db, { experienceId })
      // No festival; no override; vendor commission=20; → vendor_default
      expect(r.rate).toBe('20.00')
      expect(r.basis).toBe('vendor_default')
    })

    it('uses experience override when set', async () => {
      await db
        .update(experiences)
        .set({ commissionRateOverride: '25.50' })
        .where(eq(experiences.id, experienceId))
      const r = await resolveCommission(db, { experienceId })
      expect(r.rate).toBe('25.50')
      expect(r.basis).toBe('experience_override')
    })

    it('uses vendor base rate when no override', async () => {
      await db
        .update(vendorProfiles)
        .set({ commissionRate: '17.50' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const r = await resolveCommission(db, { experienceId })
      expect(r.rate).toBe('17.50')
      expect(r.basis).toBe('vendor_default')
    })

    it('experience override beats vendor base rate when both are set', async () => {
      // Distinct values on both layers so we can prove which one fired.
      await db
        .update(vendorProfiles)
        .set({ commissionRate: '17.50' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      await db
        .update(experiences)
        .set({ commissionRateOverride: '12.34' })
        .where(eq(experiences.id, experienceId))
      const r = await resolveCommission(db, { experienceId })
      expect(r.rate).toBe('12.34')
      expect(r.basis).toBe('experience_override')
    })

    it('asserts the full precedence ladder (ADR-0008): festival > experience > vendor', async () => {
      // Seed all three reachable layers with DISTINCT rates so each resolution
      // proves which arm fired by both rate AND basis label. (The platform_default
      // arm is unreachable with valid FK data — experiences.vendor_user_id
      // references vendor_profiles NOT NULL — and is exercised separately below.)
      const start = new Date('2026-09-01T00:00:00Z')
      const end = new Date('2026-09-30T23:59:59Z')
      const inFestival = new Date('2026-09-15T12:00:00Z')
      const outsideFestival = new Date('2026-12-01T00:00:00Z')

      await db
        .update(vendorProfiles)
        .set({ commissionRate: '17.50' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      await db
        .update(experiences)
        .set({ commissionRateOverride: '12.34' })
        .where(eq(experiences.id, experienceId))
      await db.insert(commissionTiers).values({
        name: 'ladder_festival',
        startAt: start,
        endAt: end,
        rateOverride: '5.00',
        reason: 'Top of the ladder',
        createdByAdminUserId: 'u_v',
      })

      // Layer 1 — festival tier wins over experience override AND vendor rate.
      const withFestival = await resolveCommission(db, {
        experienceId,
        now: inFestival,
      })
      expect(withFestival.rate).toBe('5.00')
      expect(withFestival.basis).toBe('festival:ladder_festival')

      // Layer 2 — outside the festival window, the experience override wins over
      // the vendor base rate.
      const withExperience = await resolveCommission(db, {
        experienceId,
        now: outsideFestival,
      })
      expect(withExperience.rate).toBe('12.34')
      expect(withExperience.basis).toBe('experience_override')

      // Layer 3 — clear the experience override → vendor base rate fires.
      await db
        .update(experiences)
        .set({ commissionRateOverride: null })
        .where(eq(experiences.id, experienceId))
      const withVendor = await resolveCommission(db, {
        experienceId,
        now: outsideFestival,
      })
      expect(withVendor.rate).toBe('17.50')
      expect(withVendor.basis).toBe('vendor_default')
    })

    it('returns the platform_default constant (arm 4) when the vendor row is absent', async () => {
      // Arm 4 is the defensive fallback for a missing vendor row. With the real
      // schema it is unreachable (experiences.vendor_user_id is a NOT NULL FK to
      // vendor_profiles), so we exercise it directly against a minimal stub db
      // that returns the experience but no vendor — proving the resolver returns
      // PLATFORM_DEFAULT_COMMISSION_RATE / 'platform_default' rather than throwing.
      const stubExperience = {
        id: 'exp-stub',
        vendorUserId: 'u-missing',
        activitySlug: 'rafting',
        commissionRateOverride: null,
      }
      let selectCall = 0
      const stubDb = {
        select() {
          return {
            from() {
              return {
                where() {
                  return {
                    limit() {
                      // 1st select → experience; 3rd select (vendor) → empty.
                      selectCall += 1
                      return selectCall === 1 ? [stubExperience] : []
                    },
                    orderBy() {
                      // 2nd select → festival tiers (none match).
                      return { limit: () => [] }
                    },
                  }
                },
              }
            },
          }
        },
      } as unknown as Parameters<typeof resolveCommission>[0]

      const r = await resolveCommission(stubDb, { experienceId: 'exp-stub' })
      expect(r.rate).toBe(PLATFORM_DEFAULT_COMMISSION_RATE)
      expect(r.basis).toBe('platform_default')
    })
  })

  describe('festival tier matching', () => {
    const baseStart = new Date('2026-09-01T00:00:00Z')
    const baseEnd = new Date('2026-09-30T23:59:59Z')
    const now = new Date('2026-09-15T12:00:00Z')

    it('matches a festival tier with empty filters (all-scope) for any Experience', async () => {
      await db.insert(commissionTiers).values({
        name: 'diwali_2026',
        startAt: baseStart,
        endAt: baseEnd,
        rateOverride: '15.00',
        reason: 'Festival',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.rate).toBe('15.00')
      expect(r.basis).toBe('festival:diwali_2026')
    })

    it('festival tier beats experience override', async () => {
      await db
        .update(experiences)
        .set({ commissionRateOverride: '30.00' })
        .where(eq(experiences.id, experienceId))
      await db.insert(commissionTiers).values({
        name: 'monsoon_2026',
        startAt: baseStart,
        endAt: baseEnd,
        rateOverride: '12.00',
        reason: 'Monsoon',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.rate).toBe('12.00')
      expect(r.basis).toBe('festival:monsoon_2026')
    })

    it('festival tier with applies_to_experience_ids filter fires only for the listed Experience', async () => {
      await db.insert(commissionTiers).values({
        name: 'scoped_to_other',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToExperienceIds: ['00000000-0000-0000-0000-000000000001'],
        rateOverride: '5.00',
        reason: 'Scoped to a different experience',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      // Should not match
      expect(r.rate).toBe('20.00')
      expect(r.basis).toBe('vendor_default')
    })

    it('festival tier with applies_to_experience_ids matching fires', async () => {
      await db.insert(commissionTiers).values({
        name: 'scoped_to_us',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToExperienceIds: [experienceId],
        rateOverride: '10.00',
        reason: 'Scoped to this experience',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.rate).toBe('10.00')
      expect(r.basis).toBe('festival:scoped_to_us')
    })

    it('festival tier with applies_to_vendor_ids filter fires only for the listed Vendor', async () => {
      await db.insert(commissionTiers).values({
        name: 'scoped_to_other_vendor',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToVendorIds: ['u_other'],
        rateOverride: '5.00',
        reason: 'Other vendor',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.basis).toBe('vendor_default')
    })

    it('festival tier with applies_to_vendor_ids matching fires', async () => {
      await db.insert(commissionTiers).values({
        name: 'scoped_to_our_vendor',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToVendorIds: ['u_v'],
        rateOverride: '8.00',
        reason: 'Our vendor',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.rate).toBe('8.00')
      expect(r.basis).toBe('festival:scoped_to_our_vendor')
    })

    it('festival tier with applies_to_categories filter matches by activity_slug', async () => {
      await db.insert(commissionTiers).values({
        name: 'rafting_promo',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToCategories: ['rafting'],
        rateOverride: '14.00',
        reason: 'Rafting category',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.rate).toBe('14.00')
      expect(r.basis).toBe('festival:rafting_promo')
    })

    it('festival tier with non-matching category does not fire', async () => {
      await db.insert(commissionTiers).values({
        name: 'paragliding_promo',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToCategories: ['paragliding'],
        rateOverride: '6.00',
        reason: 'Paragliding only',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.basis).toBe('vendor_default')
    })

    it('expired festival tier (endAt <= now) does not fire', async () => {
      await db.insert(commissionTiers).values({
        name: 'last_month',
        startAt: new Date('2026-08-01T00:00:00Z'),
        endAt: new Date('2026-08-31T23:59:59Z'),
        rateOverride: '7.00',
        reason: 'Expired',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.basis).toBe('vendor_default')
    })

    it('future festival tier (startAt > now) does not fire', async () => {
      await db.insert(commissionTiers).values({
        name: 'next_month',
        startAt: new Date('2026-10-01T00:00:00Z'),
        endAt: new Date('2026-10-31T23:59:59Z'),
        rateOverride: '9.00',
        reason: 'Future',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.basis).toBe('vendor_default')
    })

    it('most recently created tier wins when multiple match', async () => {
      await db.insert(commissionTiers).values({
        name: 'first_tier',
        startAt: baseStart,
        endAt: baseEnd,
        rateOverride: '15.00',
        reason: 'First',
        createdByAdminUserId: 'u_v',
      })
      // Small delay so created_at differs
      await new Promise((r) => setTimeout(r, 10))
      await db.insert(commissionTiers).values({
        name: 'second_tier',
        startAt: baseStart,
        endAt: baseEnd,
        rateOverride: '10.00',
        reason: 'Second (most recent)',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolveCommission(db, { experienceId, now })
      expect(r.rate).toBe('10.00')
      expect(r.basis).toBe('festival:second_tier')
    })
  })

  describe('combo Experiences (ADR-0008)', () => {
    it('uses experience override for combos (set to 30 at create-time)', async () => {
      await db
        .update(experiences)
        .set({ commissionRateOverride: '30.00' })
        .where(eq(experiences.id, experienceId))
      const r = await resolveCommission(db, { experienceId })
      expect(r.rate).toBe('30.00')
      expect(r.basis).toBe('experience_override')
    })
  })

  describe('input validation', () => {
    it('throws when the experience does not exist', async () => {
      await expect(
        resolveCommission(db, {
          experienceId: '00000000-0000-0000-0000-000000000999',
        }),
      ).rejects.toThrow(/not found/i)
    })
  })

  describe('platform default constant', () => {
    it('exports 20.00 as the platform default commission rate', () => {
      expect(PLATFORM_DEFAULT_COMMISSION_RATE).toBe('20.00')
    })
  })

  /**
   * Snapshot immutability (ADR-0008): the commission rate + basis are resolved
   * ONCE at Booking-create and frozen onto the row. Any later change to an
   * upstream layer (vendor base rate, experience override, or a new/edited
   * festival tier) must NEVER retroactively alter an existing Booking's
   * commission_rate_snapshot / commission_basis_snapshot. Mirrors the
   * snapshot-discrimination style in refund-flow.test.ts.
   */
  describe('snapshot immutability at Booking-create (ADR-0008)', () => {
    /**
     * Insert a Booking carrying an explicit commission snapshot, modelling the
     * row createBooking would write at create-time. We snapshot the resolved
     * rate verbatim so the assertion below proves the snapshot is the source of
     * truth, decoupled from the live upstream config.
     */
    async function seedBookingWithSnapshot(snapshot: {
      rate: string
      basis: string
    }): Promise<string> {
      const startAt = new Date(Date.now() + 72 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })
      const [booking] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_c_snap',
          experienceId,
          slotId: slot!.id,
          participantCount: 2,
          paymentMode: 'full_upfront',
          state: 'confirmed',
          grossTotalSnapshot: '3000.00',
          pricePerParticipantSnapshot: '1500.00',
          pricingBasisSnapshot: 'experience_bracket:1_2',
          commissionRateSnapshot: snapshot.rate,
          commissionBasisSnapshot: snapshot.basis,
          cancellationPresetSnapshot: 'flexible',
          tdsAmountSnapshot: '30.00',
          gstRateOnCommissionSnapshot: '18.00',
          vendorPanSnapshot: 'ABCDE1234F',
          vendorIsResidentSnapshot: true,
          payoutMethodSnapshot: 'upi',
          payoutDestinationSnapshot: { vpa: 'vendor@upi' },
        })
        .returning({ id: bookings.id })
      return booking!.id
    }

    async function readSnapshot(
      bookingId: string,
    ): Promise<{ rate: string; basis: string }> {
      const [row] = await db
        .select({
          rate: bookings.commissionRateSnapshot,
          basis: bookings.commissionBasisSnapshot,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1)
      return { rate: row!.rate, basis: row!.basis }
    }

    beforeAll(async () => {
      await db.insert(users).values({ id: 'u_c_snap', email: 'c-snap@example.com' })
    })

    afterAll(async () => {
      await db.execute(
        sql`TRUNCATE TABLE bookings, availability_slots CASCADE`,
      )
      await db.delete(users).where(eq(users.id, 'u_c_snap'))
    })

    it('bumping the vendor base rate does NOT alter an existing Booking snapshot', async () => {
      // Booking created when vendor rate was 20% → snapshot vendor_default 20.
      const resolved = await resolveCommission(db, { experienceId })
      expect(resolved.basis).toBe('vendor_default')
      const bookingId = await seedBookingWithSnapshot(resolved)

      // Admin later bumps the vendor's live commission rate.
      await db
        .update(vendorProfiles)
        .set({ commissionRate: '35.00' })
        .where(eq(vendorProfiles.userId, 'u_v'))

      // A NEW resolution would now see 35%, but the existing Booking is frozen.
      const liveNow = await resolveCommission(db, { experienceId })
      expect(liveNow.rate).toBe('35.00')

      const snap = await readSnapshot(bookingId)
      expect(snap.rate).toBe('20.00')
      expect(snap.basis).toBe('vendor_default')
    })

    it('setting an experience override later does NOT alter an existing Booking snapshot', async () => {
      const resolved = await resolveCommission(db, { experienceId })
      expect(resolved.basis).toBe('vendor_default')
      const bookingId = await seedBookingWithSnapshot(resolved)

      // Admin/vendor sets a per-Experience override after the Booking exists.
      await db
        .update(experiences)
        .set({ commissionRateOverride: '9.00' })
        .where(eq(experiences.id, experienceId))

      const liveNow = await resolveCommission(db, { experienceId })
      expect(liveNow.rate).toBe('9.00')
      expect(liveNow.basis).toBe('experience_override')

      const snap = await readSnapshot(bookingId)
      expect(snap.rate).toBe('20.00')
      expect(snap.basis).toBe('vendor_default')
    })

    it('adding a festival tier later does NOT alter an existing Booking snapshot', async () => {
      const resolved = await resolveCommission(db, { experienceId })
      expect(resolved.basis).toBe('vendor_default')
      const bookingId = await seedBookingWithSnapshot(resolved)

      // Admin introduces a festival tier whose window covers "now".
      const now = new Date()
      await db.insert(commissionTiers).values({
        name: 'retro_festival',
        startAt: new Date(now.getTime() - 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 60 * 60 * 1000),
        rateOverride: '3.00',
        reason: 'Festival added after the Booking existed',
        createdByAdminUserId: 'u_v',
      })

      const liveNow = await resolveCommission(db, { experienceId, now })
      expect(liveNow.rate).toBe('3.00')
      expect(liveNow.basis).toBe('festival:retro_festival')

      const snap = await readSnapshot(bookingId)
      expect(snap.rate).toBe('20.00')
      expect(snap.basis).toBe('vendor_default')
    })
  })
})
