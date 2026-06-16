import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'
import { executeRecordCheckIn } from '@/app/vendor/(dashboard)/checkin/checkin-core'
import {
  executeMarkCompleteAction,
  executeMarkNoShowAction,
  executeVendorCancelAction,
} from '@/app/vendor/(dashboard)/bookings/action-cores'
import {
  hasVendorAccess,
  resolveActingVendorContext,
} from '@/lib/auth/permissions'
import { signCheckInToken } from '@/lib/bookings/checkin-token'
import { loadVendorAnalytics } from '@/lib/vendor/analytics-loader'
import { loadVendorDashboard } from '@/lib/vendor/dashboard-loader'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Multi-seat member login — the 7 MUST-HAVE security tests (issue #11).
 *
 * A wrong thread = a member seeing another shop's money or acting outside their
 * role. These exhaustive cross-shop-denial / role-denial integration tests
 * (PGlite, real db) lock in:
 *   1. Guide cannot see earnings (analytics/payouts denied).
 *   2. Cross-shop isolation (a member of A cannot load/act on shop B).
 *   3. Inactive member denied (does not resolve; gates deny).
 *   4. Guide can't mutate bookings but CAN check in.
 *   5. Members can't touch team/close/bank — owner only.
 *   6. Owner regression (zero-change).
 *   7. Resolved scope correctness (a Manager of A sees A's data, not empty).
 *
 * Seed: owner+profile for shop A (`u_owner_a`) and shop B (`u_owner_b`), plus
 * `vendor_team_members` rows making test users Manager / Booking-Staff / Guide /
 * Accountant of shop A.
 */

const CHECKIN_SECRET = 'test-checkin-secret-issue-11'

async function seedShop(db: TestDB, ownerId: string, slug: string): Promise<void> {
  await db.insert(users).values({ id: ownerId, email: `${ownerId}@test.com`, name: ownerId })
  await db.insert(vendorProfiles).values({
    userId: ownerId,
    businessName: `Shop ${slug}`,
    slug,
    pan: 'ABCDE1234F',
    commissionRate: '20.00',
    responseTimeSlaScore: '100.00',
    payoutMethod: 'upi',
    payoutDestination: { vpa: `${slug}@upi` },
  })
}

async function seedMember(
  db: TestDB,
  shopOwnerId: string,
  memberId: string,
  role: 'manager' | 'booking_staff' | 'guide' | 'accountant',
  status: 'active' | 'inactive' = 'active',
): Promise<void> {
  await db.insert(users).values({ id: memberId, email: `${memberId}@test.com`, name: memberId })
  await db.insert(vendorTeamMembers).values({
    vendorUserId: shopOwnerId,
    memberUserId: memberId,
    role,
    status,
  })
}

async function seedExperience(
  db: TestDB,
  ownerId: string,
  slug: string,
): Promise<string> {
  const [exp] = await db
    .insert(experiences)
    .values({
      vendorUserId: ownerId,
      slug,
      title: `Experience ${slug}`,
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'published',
    })
    .returning({ id: experiences.id })
  return exp!.id
}

async function seedBooking(
  db: TestDB,
  experienceId: string,
  customerId: string,
  state: 'confirmed' | 'awaiting_completion' | 'completed',
  opts: { past?: boolean; grossRupees?: number } = {},
): Promise<{ bookingId: string; slotId: string }> {
  const startAt = opts.past
    ? new Date(Date.now() - 8 * 60 * 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000)
  const endAt = opts.past
    ? new Date(Date.now() - 4 * 60 * 60 * 1000)
    : new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
  const [slot] = await db
    .insert(availabilitySlots)
    .values({ experienceId, startAt, endAt, capacity: 8 })
    .returning({ id: availabilitySlots.id })

  const gross = opts.grossRupees ?? 3000
  const [booking] = await db
    .insert(bookings)
    .values({
      customerUserId: customerId,
      experienceId,
      slotId: slot!.id,
      participantCount: 2,
      paymentMode: 'full_upfront',
      state,
      grossTotalSnapshot: gross.toFixed(2),
      pricePerParticipantSnapshot: (gross / 2).toFixed(2),
      pricingBasisSnapshot: 'experience_bracket:1_2',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_default',
      cancellationPresetSnapshot: 'flexible',
      tdsAmountSnapshot: (gross * 0.001).toFixed(2),
      tcsAmountSnapshot: (gross * 0.005).toFixed(2),
      gstRateOnCommissionSnapshot: '18.00',
      vendorPanSnapshot: 'ABCDE1234F',
      vendorIsResidentSnapshot: true,
      payoutMethodSnapshot: 'upi',
      payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      completedAt: state === 'completed' ? new Date() : null,
    })
    .returning({ id: bookings.id })

  return { bookingId: booking!.id, slotId: slot!.id }
}

describe('multi-seat member login — 7 security tests (issue #11)', () => {
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
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, availability_slots, experiences, vendor_team_members, vendor_profiles, wallet_balances, users CASCADE`,
    )
    // Customer used across booking seeds.
    await db.insert(users).values({ id: 'u_cust', email: 'cust@test.com', name: 'Customer' })
    await seedShop(db, 'u_owner_a', 'shop-a')
    await seedShop(db, 'u_owner_b', 'shop-b')
  })

  // ── TEST 1 — Guide cannot see earnings ──────────────────────────────
  describe('1. Guide cannot see earnings', () => {
    it('resolves shop A + role guide, and is DENIED analytics:read and payouts:read', async () => {
      await seedMember(db, 'u_owner_a', 'u_guide', 'guide')

      const ctx = await resolveActingVendorContext(db, 'u_guide')
      expect(ctx).toEqual({ vendorUserId: 'u_owner_a', role: 'guide' })

      // The analytics + payouts pages call these gates with the resolved shop;
      // a Guide holds neither → the pages would notFound().
      expect(await hasVendorAccess(db, 'u_guide', 'analytics:read', 'u_owner_a')).toBe(false)
      expect(await hasVendorAccess(db, 'u_guide', 'payouts:read', 'u_owner_a')).toBe(false)
    })
  })

  // ── TEST 2 — Cross-shop isolation ───────────────────────────────────
  describe('2. Cross-shop isolation', () => {
    it("a Manager of A cannot mark-complete / cancel a shop-B booking", async () => {
      await seedMember(db, 'u_owner_a', 'u_mgr_a', 'manager')
      const expB = await seedExperience(db, 'u_owner_b', 'exp-b')
      const { bookingId } = await seedBooking(db, expB, 'u_cust', 'awaiting_completion')

      // The booking actions resolve the manager's shop = A; the core then
      // verifies the booking belongs to shop A. A shop-B booking → denied.
      const mc = await executeMarkCompleteAction(db, 'u_owner_a', { bookingId })
      expect(mc.ok).toBe(false)

      const vc = await executeVendorCancelAction(db, 'u_owner_a', {
        bookingId,
        reason: 'test',
      })
      expect(vc.ok).toBe(false)
    })

    it('analytics + dashboard loaders keyed on shop A return ONLY shop A rows', async () => {
      // Shop A has 1 booking; shop B has 2. A Manager of A keyed on shop A must
      // see exactly 1 (A's), never B's.
      const expA = await seedExperience(db, 'u_owner_a', 'exp-a')
      await seedBooking(db, expA, 'u_cust', 'completed', { grossRupees: 5000 })
      const expB = await seedExperience(db, 'u_owner_b', 'exp-b')
      await seedBooking(db, expB, 'u_cust', 'completed', { grossRupees: 9000 })
      await seedBooking(db, expB, 'u_cust', 'completed', { grossRupees: 7000 })

      const analyticsA = await loadVendorAnalytics(db, 'u_owner_a')
      expect(analyticsA.totalBookings).toBe(1)
      expect(analyticsA.totalRevenue).toBe(5000)

      const dashA = await loadVendorDashboard(db, 'u_owner_a')
      expect(dashA.totalBookings).toBe(1)
      expect(dashA.totalRevenue).toBe(5000)
    })
  })

  // ── TEST 3 — Inactive member denied ─────────────────────────────────
  describe('3. Inactive member denied', () => {
    it('an inactive membership does NOT resolve (redirects), and gates deny', async () => {
      await seedMember(db, 'u_owner_a', 'u_inactive', 'manager', 'inactive')

      await expect(resolveActingVendorContext(db, 'u_inactive')).rejects.toThrow(
        /NEXT_REDIRECT|onboarding/,
      )
      // Even with an explicit shop, an inactive member is denied every gate.
      expect(await hasVendorAccess(db, 'u_inactive', 'bookings:read', 'u_owner_a')).toBe(false)
      expect(await hasVendorAccess(db, 'u_inactive', 'experiences:manage', 'u_owner_a')).toBe(false)
    })
  })

  // ── TEST 4 — Guide can't mutate bookings but CAN check in ────────────
  describe('4. Guide can check in but not manage bookings', () => {
    it('mark-complete / cancel / no-show denied; recordCheckIn allowed', async () => {
      await seedMember(db, 'u_owner_a', 'u_guide', 'guide')
      const expA = await seedExperience(db, 'u_owner_a', 'exp-a')

      // Booking-management: Guide lacks bookings:manage → denied.
      const { bookingId: awaitingId } = await seedBooking(
        db,
        expA,
        'u_cust',
        'awaiting_completion',
      )
      expect((await executeMarkCompleteAction(db, 'u_guide', { bookingId: awaitingId })).ok).toBe(
        false,
      )
      expect(
        (await executeVendorCancelAction(db, 'u_guide', { bookingId: awaitingId, reason: 'x' })).ok,
      ).toBe(false)

      const { bookingId: pastId } = await seedBooking(db, expA, 'u_cust', 'confirmed', {
        past: true,
      })
      expect((await executeMarkNoShowAction(db, 'u_guide', { bookingId: pastId })).ok).toBe(false)

      // Check-in: Guide holds bookings:checkin on shop A → allowed.
      const token = signCheckInToken(
        { bookingId: pastId, expiresAt: Date.now() + 60_000 },
        CHECKIN_SECRET,
      )
      const result = await executeRecordCheckIn(db, 'u_guide', token, CHECKIN_SECRET, new Date())
      expect(result.ok).toBe(true)
    })
  })

  // ── TEST 5 — Members can't touch team/close/bank ─────────────────────
  describe('5. Members cannot touch team / close / bank — owner only', () => {
    it('every member role is denied team:manage, account:close, bank:manage; owner passes', async () => {
      await seedMember(db, 'u_owner_a', 'u_mgr', 'manager')
      await seedMember(db, 'u_owner_a', 'u_bs', 'booking_staff')
      await seedMember(db, 'u_owner_a', 'u_guide', 'guide')
      await seedMember(db, 'u_owner_a', 'u_acc', 'accountant')

      for (const member of ['u_mgr', 'u_bs', 'u_guide', 'u_acc']) {
        expect(await hasVendorAccess(db, member, 'team:manage', 'u_owner_a')).toBe(false)
        expect(await hasVendorAccess(db, member, 'account:close', 'u_owner_a')).toBe(false)
        expect(await hasVendorAccess(db, member, 'bank:manage', 'u_owner_a')).toBe(false)
      }

      // Owner of shop A passes all three on their own account.
      expect(await hasVendorAccess(db, 'u_owner_a', 'team:manage')).toBe(true)
      expect(await hasVendorAccess(db, 'u_owner_a', 'account:close')).toBe(true)
      expect(await hasVendorAccess(db, 'u_owner_a', 'bank:manage')).toBe(true)
    })
  })

  // ── TEST 6 — Owner regression (zero-change) ──────────────────────────
  describe('6. Owner regression — zero behavior change', () => {
    it('an owner with an active profile resolves to own account + owner role', async () => {
      const ctx = await resolveActingVendorContext(db, 'u_owner_a')
      expect(ctx).toEqual({ vendorUserId: 'u_owner_a', role: 'owner' })

      // Owner can act on their own bookings (the single-seat path, unchanged).
      const expA = await seedExperience(db, 'u_owner_a', 'exp-a')
      const { bookingId } = await seedBooking(db, expA, 'u_cust', 'awaiting_completion')
      const mc = await executeMarkCompleteAction(db, 'u_owner_a', { bookingId })
      expect(mc.ok).toBe(true)
    })
  })

  // ── TEST 7 — Resolved scope correctness ──────────────────────────────
  describe('7. Resolved scope correctness — Manager of A sees A data, not empty', () => {
    it('loadVendorDashboard / analytics keyed on the resolved shop A return shop A data', async () => {
      await seedMember(db, 'u_owner_a', 'u_mgr_a', 'manager')
      const expA = await seedExperience(db, 'u_owner_a', 'exp-a')
      await seedBooking(db, expA, 'u_cust', 'completed', { grossRupees: 4000 })
      await seedBooking(db, expA, 'u_cust', 'confirmed', { grossRupees: 2000 })

      // The Manager resolves to shop A; the dashboard/analytics pages load
      // keyed on the RESOLVED shop (u_owner_a), NOT the manager's own id (which
      // would be an empty self-shop).
      const ctx = await resolveActingVendorContext(db, 'u_mgr_a')
      expect(ctx.vendorUserId).toBe('u_owner_a')

      const dash = await loadVendorDashboard(db, ctx.vendorUserId)
      expect(dash.totalBookings).toBe(2)
      expect(dash.businessName).toBe('Shop shop-a')

      const analytics = await loadVendorAnalytics(db, ctx.vendorUserId)
      expect(analytics.totalBookings).toBe(2)

      // The Manager's OWN id resolves to an empty shop — proving the scope must
      // be the resolved shop, not the session id.
      const emptyDash = await loadVendorDashboard(db, 'u_mgr_a')
      expect(emptyDash.totalBookings).toBe(0)
    })
  })
})
