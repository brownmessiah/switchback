import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { availabilitySlots } from './availability-slots'
import { experiences } from './experiences'
import { regionClosures } from './region-closures'
import { slugRedirects } from './slug-redirects'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

describe('experiences + availability_slots + region_closures + slug_redirects (ADRs 0011/0013)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Seed one Vendor for every test in this file — Experience needs an FK.
    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Wipe experiences table between cases (cascades to availability_slots).
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
    await db.execute(sql`TRUNCATE TABLE region_closures`)
    await db.execute(sql`TRUNCATE TABLE slug_redirects`)
  })

  describe('experiences (ADRs 0001, 0002, 0005, 0008, 0011, 0013, 0015)', () => {
    function baseExperience(): typeof experiences.$inferInsert {
      return {
        vendorUserId: 'u_v',
        slug: 'rafting-day-trip',
        title: 'Rishikesh Rafting Day Trip',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      }
    }

    it('inserts a minimal Experience with sane defaults', async () => {
      await db.insert(experiences).values(baseExperience())
      const [row] = await db.select().from(experiences).where(eq(experiences.slug, 'rafting-day-trip'))
      expect(row?.isCombo).toBe(false)
      expect(row?.requiresSafetyStack).toBe(false)
      expect(row?.requiredPermits).toEqual([])
      expect(row?.status).toBe('draft')
      expect(row?.commissionRateOverride).toBeNull()
    })

    it('enforces slug uniqueness across Experiences', async () => {
      await db.insert(experiences).values(baseExperience())
      await expect(
        db.insert(experiences).values({ ...baseExperience(), slug: 'rafting-day-trip' }),
      ).rejects.toThrow()
    })

    it('stores all four cancellation presets without error', async () => {
      const presets = ['flexible', 'moderate', 'strict', 'custom'] as const
      for (const preset of presets) {
        await db.insert(experiences).values({
          ...baseExperience(),
          slug: `cancel-${preset}`,
          cancellationPreset: preset,
          cancellationPolicyText: preset === 'custom' ? 'Bespoke trek policy' : null,
        })
      }
      const allRows = await db.select().from(experiences)
      expect(allRows.map((r) => r.cancellationPreset).sort()).toEqual(
        ['custom', 'flexible', 'moderate', 'strict'],
      )
    })

    it('rejects unknown cancellationPreset values', async () => {
      await expect(
        db.execute(
          sql`INSERT INTO experiences (vendor_user_id, slug, title, cancellation_preset, payment_modes_allowed, price_per_person_1_2, price_per_person_3_5, price_per_person_6_plus, region_slug, activity_slug)
              VALUES ('u_v', 'bad', 'Bad', 'super_flexible', ARRAY['full_upfront']::payment_mode[], '100', '100', '100', 'r', 'a')`,
        ),
      ).rejects.toThrow()
    })

    it('stores all three payment_modes_allowed values (including RNPL placeholder per ADR-0002)', async () => {
      await db.insert(experiences).values({
        ...baseExperience(),
        paymentModesAllowed: ['full_upfront', 'partial_pay', 'reserve_now_pay_later'],
      })
      const [row] = await db.select().from(experiences).where(eq(experiences.slug, 'rafting-day-trip'))
      expect(row?.paymentModesAllowed).toEqual([
        'full_upfront',
        'partial_pay',
        'reserve_now_pay_later',
      ])
    })

    describe('combo invariants (ADR-0008 + ADR-0013)', () => {
      it('rejects is_combo=true with empty combo_constituents (CHECK combo_has_constituents)', async () => {
        await expect(
          db.insert(experiences).values({
            ...baseExperience(),
            slug: 'combo-without-children',
            isCombo: true,
            comboConstituents: [],
          }),
        ).rejects.toThrow()
      })

      it('rejects is_combo=true with a single constituent', async () => {
        await expect(
          db.insert(experiences).values({
            ...baseExperience(),
            slug: 'combo-singleton',
            isCombo: true,
            comboConstituents: ['00000000-0000-0000-0000-000000000001'],
          }),
        ).rejects.toThrow()
      })

      it('rejects a non-combo slug starting with combo- (CHECK combo_slug_prefix)', async () => {
        await expect(
          db.insert(experiences).values({
            ...baseExperience(),
            slug: 'combo-imposter',
            isCombo: false,
          }),
        ).rejects.toThrow()
      })

      it('rejects a combo slug NOT starting with combo-', async () => {
        // First insert two regular Experiences to use as constituents
        await db.insert(experiences).values({
          ...baseExperience(),
          slug: 'rafting',
        })
        await db.insert(experiences).values({
          ...baseExperience(),
          slug: 'paragliding',
        })

        const all = await db.select({ id: experiences.id }).from(experiences)
        const ids = all.map((r) => r.id)

        await expect(
          db.insert(experiences).values({
            ...baseExperience(),
            slug: 'rafting-paragliding-bundle', // missing combo- prefix
            isCombo: true,
            comboConstituents: ids,
          }),
        ).rejects.toThrow()
      })

      it('accepts a valid Combo Experience', async () => {
        await db.insert(experiences).values({
          ...baseExperience(),
          slug: 'rafting',
        })
        await db.insert(experiences).values({
          ...baseExperience(),
          slug: 'paragliding',
        })
        const all = await db.select({ id: experiences.id }).from(experiences)
        const ids = all.map((r) => r.id)

        await db.insert(experiences).values({
          ...baseExperience(),
          slug: 'combo-rafting-paragliding',
          isCombo: true,
          comboConstituents: ids,
          commissionRateOverride: '30.00',
        })

        const [combo] = await db
          .select()
          .from(experiences)
          .where(eq(experiences.slug, 'combo-rafting-paragliding'))
        expect(combo?.isCombo).toBe(true)
        expect(combo?.comboConstituents?.length).toBe(2)
        expect(combo?.commissionRateOverride).toBe('30.00')
      })
    })

    it('persists required_permits and requires_safety_stack', async () => {
      await db.insert(experiences).values({
        ...baseExperience(),
        slug: 'permit-trek',
        requiredPermits: ['ilp_sikkim', 'wildlife_corbett'],
        requiresSafetyStack: true,
      })
      const [row] = await db.select().from(experiences).where(eq(experiences.slug, 'permit-trek'))
      expect(row?.requiredPermits).toEqual(['ilp_sikkim', 'wildlife_corbett'])
      expect(row?.requiresSafetyStack).toBe(true)
    })
  })

  describe('availability_slots (ADR-0011)', () => {
    async function seedExperience(slug = 'slot-test') {
      const [row] = await db
        .insert(experiences)
        .values({
          vendorUserId: 'u_v',
          slug,
          title: 'Slot Test',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '500',
          pricePerPerson_3_5: '500',
          pricePerPerson_6_plus: '500',
          regionSlug: 'r',
          activitySlug: 'a',
        })
        .returning({ id: experiences.id })
      return row!.id
    }

    it('rejects capacity_taken > capacity (CHECK capacity_within_bounds)', async () => {
      const experienceId = await seedExperience()
      await expect(
        db.insert(availabilitySlots).values({
          experienceId,
          startAt: new Date('2026-09-01T08:00:00Z'),
          endAt: new Date('2026-09-01T12:00:00Z'),
          capacity: 8,
          capacityTaken: 9,
        }),
      ).rejects.toThrow()
    })

    it('rejects capacity <= 0', async () => {
      const experienceId = await seedExperience()
      await expect(
        db.insert(availabilitySlots).values({
          experienceId,
          startAt: new Date('2026-09-01T08:00:00Z'),
          endAt: new Date('2026-09-01T12:00:00Z'),
          capacity: 0,
        }),
      ).rejects.toThrow()
    })

    it('rejects end_at <= start_at', async () => {
      const experienceId = await seedExperience()
      await expect(
        db.insert(availabilitySlots).values({
          experienceId,
          startAt: new Date('2026-09-01T12:00:00Z'),
          endAt: new Date('2026-09-01T08:00:00Z'),
          capacity: 8,
        }),
      ).rejects.toThrow()
    })

    it('enforces unique (experience_id, start_at)', async () => {
      const experienceId = await seedExperience()
      const start = new Date('2026-09-01T08:00:00Z')
      const end = new Date('2026-09-01T12:00:00Z')

      await db.insert(availabilitySlots).values({
        experienceId,
        startAt: start,
        endAt: end,
        capacity: 8,
      })
      await expect(
        db.insert(availabilitySlots).values({
          experienceId,
          startAt: start,
          endAt: end,
          capacity: 8,
        }),
      ).rejects.toThrow()
    })

    it('defaults status to open and capacity_taken to 0', async () => {
      const experienceId = await seedExperience()
      await db.insert(availabilitySlots).values({
        experienceId,
        startAt: new Date('2026-09-01T08:00:00Z'),
        endAt: new Date('2026-09-01T12:00:00Z'),
        capacity: 8,
      })
      const [slot] = await db.select().from(availabilitySlots)
      expect(slot?.status).toBe('open')
      expect(slot?.capacityTaken).toBe(0)
    })

    it('cascades slot deletion when Experience is deleted', async () => {
      const experienceId = await seedExperience()
      await db.insert(availabilitySlots).values({
        experienceId,
        startAt: new Date('2026-09-01T08:00:00Z'),
        endAt: new Date('2026-09-01T12:00:00Z'),
        capacity: 8,
      })
      await db.delete(experiences).where(eq(experiences.id, experienceId))
      const remaining = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))
      expect(remaining).toHaveLength(0)
    })
  })

  describe('region_closures (ADR-0011)', () => {
    it('stores admin- and vendor-sourced closures', async () => {
      await db.insert(regionClosures).values([
        {
          regionSlug: 'rishikesh',
          startAt: new Date('2026-07-01T00:00:00Z'),
          endAt: new Date('2026-09-14T23:59:59Z'),
          reason: 'Monsoon — rafting closed',
          source: 'admin',
        },
        {
          regionSlug: 'rishikesh',
          startAt: new Date('2026-10-15T00:00:00Z'),
          endAt: new Date('2026-10-17T00:00:00Z'),
          reason: 'Equipment maintenance',
          source: 'vendor',
        },
      ])
      const rows = await db.select().from(regionClosures)
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.source).sort()).toEqual(['admin', 'vendor'])
    })

    it('rejects closures with end_at <= start_at', async () => {
      await expect(
        db.insert(regionClosures).values({
          regionSlug: 'r',
          startAt: new Date('2026-07-02T00:00:00Z'),
          endAt: new Date('2026-07-01T00:00:00Z'),
          reason: 'bad',
          source: 'admin',
        }),
      ).rejects.toThrow()
    })
  })

  describe('slug_redirects (ADR-0013)', () => {
    it('stores a retired slug per entity_type', async () => {
      await db.insert(slugRedirects).values({
        entityType: 'experience',
        entityId: 'exp_1',
        oldSlug: 'old-slug',
      })
      const [row] = await db.select().from(slugRedirects)
      expect(row?.oldSlug).toBe('old-slug')
      expect(row?.retiredAt).toBeInstanceOf(Date)
    })

    it('rejects duplicate (entity_type, old_slug) pairs', async () => {
      await db.insert(slugRedirects).values({
        entityType: 'vendor',
        entityId: 'v_1',
        oldSlug: 'old',
      })
      await expect(
        db.insert(slugRedirects).values({
          entityType: 'vendor',
          entityId: 'v_2',
          oldSlug: 'old',
        }),
      ).rejects.toThrow()
    })

    it('allows the same old_slug across different entity_types', async () => {
      await db.insert(slugRedirects).values({
        entityType: 'vendor',
        entityId: 'v_1',
        oldSlug: 'shared',
      })
      await db.insert(slugRedirects).values({
        entityType: 'experience',
        entityId: 'e_1',
        oldSlug: 'shared',
      })
      const rows = await db.select().from(slugRedirects)
      expect(rows).toHaveLength(2)
    })
  })
})
