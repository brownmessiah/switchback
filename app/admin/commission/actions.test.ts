import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeCreateCommissionTier,
  executeUpdateCommissionTier,
  executeDeleteCommissionTier,
  getAffectedBookingCount,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_commission_1'
  await db.insert(users).values({ id: adminId, email: 'admin-commission@test.com' })
  return adminId
}

function futureDate(daysFromNow: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d
}

function pastDate(daysAgo: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Admin commission tier actions', () => {
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
      sql`TRUNCATE TABLE audit_logs, commission_tiers, users CASCADE`,
    )
  })

  // ── Create Tier ────────────────────────────────────────────────────

  describe('executeCreateCommissionTier', () => {
    it('creates tier with valid data and writes audit log', async () => {
      const adminId = await seedAdmin(db)
      const startAt = futureDate(10)
      const endAt = futureDate(20)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'diwali-2026',
        startAt,
        endAt,
        rateOverride: 15,
        reason: 'Festival season discount',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(true)

      // Verify tier created
      const tiers = await db.select().from(commissionTiers)
      expect(tiers).toHaveLength(1)
      expect(tiers[0]!.name).toBe('diwali-2026')
      expect(Number(tiers[0]!.rateOverride)).toBe(15)
      expect(tiers[0]!.reason).toBe('Festival season discount')
      expect(tiers[0]!.createdByAdminUserId).toBe(adminId)

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]!.action).toBe('admin.commission_tier.create')
      expect(logs[0]!.actorUserId).toBe(adminId)
      expect(logs[0]!.entityType).toBe('commission_tier')
      expect(logs[0]!.payload).toMatchObject({
        name: 'diwali-2026',
        rateOverride: 15,
      })
    })

    it('creates tier with scope filters', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'rafting-festival',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: 10,
        reason: 'Rishikesh rafting season',
        appliesToCategories: ['rafting', 'kayaking'],
        appliesToVendorIds: ['vendor_1', 'vendor_2'],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(true)

      const [tier] = await db.select().from(commissionTiers)
      expect(tier!.appliesToCategories).toEqual(['rafting', 'kayaking'])
      expect(tier!.appliesToVendorIds).toEqual(['vendor_1', 'vendor_2'])
      expect(tier!.appliesToExperienceIds).toEqual([])
    })

    it('rejects end_at <= start_at', async () => {
      const adminId = await seedAdmin(db)
      const start = futureDate(20)
      const end = futureDate(10)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'bad-dates',
        startAt: start,
        endAt: end,
        rateOverride: 15,
        reason: 'test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('End date')
      }

      // No tier created
      const tiers = await db.select().from(commissionTiers)
      expect(tiers).toHaveLength(0)
    })

    it('rejects end_at equal to start_at', async () => {
      const adminId = await seedAdmin(db)
      const sameDate = futureDate(10)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'same-dates',
        startAt: sameDate,
        endAt: sameDate,
        rateOverride: 15,
        reason: 'test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('End date')
      }
    })

    it('rejects rate below 0', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'negative-rate',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: -1,
        reason: 'test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('0')
      }
    })

    it('rejects rate above 100', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'over-100',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: 101,
        reason: 'test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('100')
      }
    })

    it('accepts rate of exactly 0', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'zero-rate',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: 0,
        reason: 'Free festival',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(true)
    })

    it('accepts rate of exactly 100', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'full-rate',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: 100,
        reason: 'Full commission',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(true)
    })

    it('rejects missing name', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: '',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: 15,
        reason: 'test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(false)
    })

    it('rejects missing reason', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateCommissionTier(db, adminId, {
        name: 'test',
        startAt: futureDate(5),
        endAt: futureDate(15),
        rateOverride: 15,
        reason: '',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      expect(result.ok).toBe(false)
    })
  })

  // ── Update Tier ───────────────────────────────────────────────────

  describe('executeUpdateCommissionTier', () => {
    it('updates tier fields and writes audit log', async () => {
      const adminId = await seedAdmin(db)

      // Seed a tier
      await executeCreateCommissionTier(db, adminId, {
        name: 'original',
        startAt: futureDate(10),
        endAt: futureDate(20),
        rateOverride: 15,
        reason: 'initial',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      const [tier] = await db.select().from(commissionTiers)
      const tierId = tier!.id

      const newEnd = futureDate(25)
      const result = await executeUpdateCommissionTier(db, adminId, {
        id: tierId,
        name: 'updated',
        endAt: newEnd,
        rateOverride: 20,
        reason: 'updated reason',
      })

      expect(result.ok).toBe(true)

      // Verify update
      const [updated] = await db
        .select()
        .from(commissionTiers)
        .where(eq(commissionTiers.id, tierId))
      expect(updated!.name).toBe('updated')
      expect(Number(updated!.rateOverride)).toBe(20)
      expect(updated!.reason).toBe('updated reason')

      // Verify audit log for update (second log after create)
      const logs = await db
        .select()
        .from(auditLogs)
        .orderBy(auditLogs.createdAt)
      const updateLog = logs.find((l) => l.action === 'admin.commission_tier.update')
      expect(updateLog).toBeDefined()
      expect(updateLog!.actorUserId).toBe(adminId)
      expect(updateLog!.entityId).toBe(tierId)
    })

    it('rejects update with invalid date range', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateCommissionTier(db, adminId, {
        name: 'original',
        startAt: futureDate(10),
        endAt: futureDate(20),
        rateOverride: 15,
        reason: 'initial',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      const [tier] = await db.select().from(commissionTiers)

      // Try to update endAt to before startAt
      const result = await executeUpdateCommissionTier(db, adminId, {
        id: tier!.id,
        endAt: futureDate(5), // before the start of futureDate(10)
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('End date')
      }
    })

    it('rejects update with invalid rate', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateCommissionTier(db, adminId, {
        name: 'original',
        startAt: futureDate(10),
        endAt: futureDate(20),
        rateOverride: 15,
        reason: 'initial',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      const [tier] = await db.select().from(commissionTiers)

      const result = await executeUpdateCommissionTier(db, adminId, {
        id: tier!.id,
        rateOverride: 150,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('100')
      }
    })

    it('returns error for non-existent tier', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeUpdateCommissionTier(db, adminId, {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'ghost',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // ── Delete Tier ───────────────────────────────────────────────────

  describe('executeDeleteCommissionTier', () => {
    it('deletes tier and writes audit log', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateCommissionTier(db, adminId, {
        name: 'to-delete',
        startAt: futureDate(10),
        endAt: futureDate(20),
        rateOverride: 15,
        reason: 'temporary',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })

      const [tier] = await db.select().from(commissionTiers)
      const tierId = tier!.id

      const result = await executeDeleteCommissionTier(db, adminId, tierId)

      expect(result.ok).toBe(true)

      // Verify tier deleted
      const remaining = await db.select().from(commissionTiers)
      expect(remaining).toHaveLength(0)

      // Verify audit log for delete
      const logs = await db.select().from(auditLogs)
      const deleteLog = logs.find((l) => l.action === 'admin.commission_tier.delete')
      expect(deleteLog).toBeDefined()
      expect(deleteLog!.actorUserId).toBe(adminId)
      expect(deleteLog!.entityType).toBe('commission_tier')
      expect(deleteLog!.entityId).toBe(tierId)
      expect(deleteLog!.payload).toMatchObject({
        name: 'to-delete',
      })
    })

    it('returns error for non-existent tier', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeDeleteCommissionTier(
        db,
        adminId,
        '00000000-0000-0000-0000-000000000000',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // ── getAffectedBookingCount ───────────────────────────────────────
  //
  // Counts Bookings whose created_at falls inside the tier's [start_at, end_at]
  // window — the "blast radius" preview an admin sees before editing/deleting a
  // tier. Snapshots are immutable (ADR-0008), so this is a forward-looking count
  // of which future Bookings the live tier change would influence, not a count
  // of rows whose snapshot would change.

  describe('getAffectedBookingCount', () => {
    /**
     * Seed a confirmed Booking with an explicit created_at so we can place it
     * deterministically inside/outside a tier's time window. All other snapshot
     * columns are filled with valid placeholders.
     */
    async function seedBookingAt(createdAt: Date): Promise<string> {
      const startAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId: affectExperienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })
      const [booking] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_c_affect',
          experienceId: affectExperienceId,
          slotId: slot!.id,
          participantCount: 2,
          paymentMode: 'full_upfront',
          state: 'confirmed',
          createdAt,
          grossTotalSnapshot: '3000.00',
          pricePerParticipantSnapshot: '1500.00',
          pricingBasisSnapshot: 'experience_bracket:1_2',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'vendor_default',
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

    let affectExperienceId: string

    beforeEach(async () => {
      // The top-level beforeEach truncates audit_logs/commission_tiers/users.
      // Re-seed the vendor + experience + customer this block needs, and clear
      // any bookings/slots left from prior tests in this block.
      await db.execute(
        sql`TRUNCATE TABLE bookings, availability_slots, experiences, vendor_profiles CASCADE`,
      )
      await db.insert(users).values([
        { id: 'u_v_affect', email: 'v-affect@test.com' },
        { id: 'u_c_affect', email: 'c-affect@test.com' },
      ])
      await db.insert(vendorProfiles).values({
        userId: 'u_v_affect',
        businessName: 'Affect Adventures',
        slug: 'affect-adventures',
        commissionRate: '20.00',
      })
      const [exp] = await db
        .insert(experiences)
        .values({
          vendorUserId: 'u_v_affect',
          slug: 'affect-rafting',
          title: 'Affect Rafting',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '1500',
          pricePerPerson_3_5: '1300',
          pricePerPerson_6_plus: '1100',
          regionSlug: 'rishikesh',
          activitySlug: 'rafting',
        })
        .returning({ id: experiences.id })
      affectExperienceId = exp!.id
    })

    it('returns 0 for a non-existent tier id', async () => {
      const count = await getAffectedBookingCount(
        db,
        '00000000-0000-0000-0000-000000000000',
      )
      expect(count).toBe(0)
    })

    it('counts only Bookings whose created_at falls inside the tier window', async () => {
      const adminId = await seedAdmin(db)
      const windowStart = new Date('2026-09-01T00:00:00Z')
      const windowEnd = new Date('2026-09-30T23:59:59Z')

      await executeCreateCommissionTier(db, adminId, {
        name: 'september-window',
        startAt: windowStart,
        endAt: windowEnd,
        rateOverride: 15,
        reason: 'window test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })
      const [tier] = await db.select().from(commissionTiers)

      // Two inside the window, one before, one after.
      await seedBookingAt(new Date('2026-09-10T08:00:00Z')) // inside
      await seedBookingAt(new Date('2026-09-20T08:00:00Z')) // inside
      await seedBookingAt(new Date('2026-08-15T08:00:00Z')) // before window
      await seedBookingAt(new Date('2026-10-05T08:00:00Z')) // after window

      const count = await getAffectedBookingCount(db, tier!.id)
      expect(count).toBe(2)
    })

    it('returns 0 when no Bookings fall inside the tier window', async () => {
      const adminId = await seedAdmin(db)
      await executeCreateCommissionTier(db, adminId, {
        name: 'empty-window',
        startAt: new Date('2027-01-01T00:00:00Z'),
        endAt: new Date('2027-01-31T23:59:59Z'),
        rateOverride: 10,
        reason: 'no bookings',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })
      const [tier] = await db.select().from(commissionTiers)

      // All bookings fall well outside the 2027 January window.
      await seedBookingAt(new Date('2026-06-01T08:00:00Z'))
      await seedBookingAt(new Date('2026-12-31T08:00:00Z'))

      const count = await getAffectedBookingCount(db, tier!.id)
      expect(count).toBe(0)
    })

    it('counts Bookings on the inclusive window boundaries (start_at, end_at)', async () => {
      const adminId = await seedAdmin(db)
      const windowStart = new Date('2026-09-01T00:00:00.000Z')
      const windowEnd = new Date('2026-09-30T23:59:59.000Z')

      await executeCreateCommissionTier(db, adminId, {
        name: 'boundary-window',
        startAt: windowStart,
        endAt: windowEnd,
        rateOverride: 12,
        reason: 'boundary test',
        appliesToCategories: [],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
      })
      const [tier] = await db.select().from(commissionTiers)

      // Exactly on the inclusive boundaries (gte start, lte end) → both count.
      await seedBookingAt(windowStart)
      await seedBookingAt(windowEnd)
      // One millisecond before start → excluded.
      await seedBookingAt(new Date(windowStart.getTime() - 1))

      const count = await getAffectedBookingCount(db, tier!.id)
      expect(count).toBe(2)
    })
  })
})
