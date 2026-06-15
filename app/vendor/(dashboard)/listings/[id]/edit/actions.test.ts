import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadItinerary } from '@/lib/experiences/itinerary'
import type { MeiliLike } from '@/lib/search/meilisearch-client'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeUpdateExperience,
  type UpdateExperienceInput,
} from './update-core'

/**
 * A capturing Meilisearch stub honouring the indexer surface, so the edit
 * action's re-index behaviour (ADR-0013) can be asserted without a live
 * Meilisearch instance.
 */
function makeSearchStub(): {
  client: MeiliLike
  addCalls: unknown[][]
  deleteCalls: string[]
} {
  const addCalls: unknown[][] = []
  const deleteCalls: string[] = []
  const client: MeiliLike = {
    index: () => ({
      addDocuments: async (docs) => {
        addCalls.push(docs as unknown[])
        return { taskUid: 1 }
      },
      deleteDocument: async (id) => {
        deleteCalls.push(String(id))
        return { taskUid: 2 }
      },
      search: vi.fn(async () => ({ hits: [] })),
      updateSettings: vi.fn(async () => ({ taskUid: 3 })),
    }),
  }
  return { client, addCalls, deleteCalls }
}

describe('executeUpdateExperience', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_vendor_edit', email: 'vendor-edit@test.com' },
      { id: 'u_other', email: 'other@test.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor_edit',
      businessName: 'Edit Test Vendor',
      slug: 'edit-test-vendor',
    })
    await db.insert(vendorProfiles).values({
      userId: 'u_other',
      businessName: 'Other Vendor',
      slug: 'other-vendor',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor_edit',
        slug: 'edit-test-exp',
        title: 'Original Title',
        shortDescription: 'Original short desc',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })

    experienceId = row.id
  })

  function validInput(overrides: Partial<UpdateExperienceInput> = {}): UpdateExperienceInput {
    return {
      id: experienceId,
      title: 'Updated Title',
      shortDescription: 'Updated short desc',
      longDescription: 'Updated long desc',
      activitySlug: 'paragliding',
      regionSlug: 'manali',
      pricePerPerson_1_2: 2000,
      pricePerPerson_3_5: 1800,
      pricePerPerson_6_plus: 1500,
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront', 'partial_pay'],
      isCombo: false,
      requiredPermits: ['forest_department'],
      requiresSafetyStack: true,
      ...overrides,
    }
  }

  describe('validation', () => {
    it('rejects empty title', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ title: '' }),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Validation failed.')
        expect(result.fieldErrors?.title).toBeDefined()
      }
    })

    it('rejects negative price', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ pricePerPerson_1_2: -100 }),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.fieldErrors?.pricePerPerson_1_2).toBeDefined()
      }
    })

    it('rejects zero price', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ pricePerPerson_1_2: 0 }),
      )

      expect(result.ok).toBe(false)
    })

    it('rejects empty payment modes', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ paymentModesAllowed: [] }),
      )

      expect(result.ok).toBe(false)
    })

    it('rejects missing activity slug', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ activitySlug: '' }),
      )

      expect(result.ok).toBe(false)
    })

    it('rejects invalid experience ID format', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ id: 'not-a-uuid' }),
      )

      expect(result.ok).toBe(false)
    })
  })

  describe('ownership', () => {
    it('rejects update by a different vendor', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_other',
        validInput(),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('You do not own this experience.')
      }
    })

    it('returns not found for non-existent experience', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ id: '00000000-0000-0000-0000-000000000000' }),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Experience not found.')
      }
    })
  })

  describe('persistence', () => {
    it('updates the experience with all fields', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput(),
      )

      expect(result.ok).toBe(true)

      const [updated] = await db
        .select()
        .from(experiences)
        .where(eq(experiences.id, experienceId))

      expect(updated.title).toBe('Updated Title')
      expect(updated.shortDescription).toBe('Updated short desc')
      expect(updated.longDescription).toBe('Updated long desc')
      expect(updated.activitySlug).toBe('paragliding')
      expect(updated.regionSlug).toBe('manali')
      expect(updated.pricePerPerson_1_2).toBe('2000.00')
      expect(updated.pricePerPerson_3_5).toBe('1800.00')
      expect(updated.pricePerPerson_6_plus).toBe('1500.00')
      expect(updated.cancellationPreset).toBe('moderate')
      expect(updated.paymentModesAllowed).toEqual(['full_upfront', 'partial_pay'])
      expect(updated.isCombo).toBe(false)
      expect(updated.requiredPermits).toEqual(['forest_department'])
      expect(updated.requiresSafetyStack).toBe(true)
    })

    it('preserves slug when updating other fields', async () => {
      await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ title: 'New Title' }),
      )

      const [updated] = await db
        .select()
        .from(experiences)
        .where(eq(experiences.id, experienceId))

      expect(updated.slug).toBe('edit-test-exp')
      expect(updated.title).toBe('New Title')
    })

    it('clears optional fields when set to null', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ shortDescription: null, longDescription: null }),
      )

      expect(result.ok).toBe(true)

      const [updated] = await db
        .select()
        .from(experiences)
        .where(eq(experiences.id, experienceId))

      expect(updated.shortDescription).toBeNull()
      expect(updated.longDescription).toBeNull()
    })

    it('updates the updatedAt timestamp', async () => {
      const [before] = await db
        .select({ updatedAt: experiences.updatedAt })
        .from(experiences)
        .where(eq(experiences.id, experienceId))

      // Small delay to ensure timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10))

      await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput(),
      )

      const [after] = await db
        .select({ updatedAt: experiences.updatedAt })
        .from(experiences)
        .where(eq(experiences.id, experienceId))

      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
    })
  })

  // ── ADR-0007 Tier-2 cap enforcement on edits of live listings ─────
  //
  // Editing a draft is unrestricted (a phone-tier Vendor may draft).
  // Editing a published / pending_review / paused listing must stay
  // within the Vendor's KYC-tier caps so a Vendor cannot escalate a live
  // listing past their tier via the edit form.
  describe('tier-cap enforcement (ADR-0007)', () => {
    async function setVendorTier(tier: 'phone' | 'identity' | 'business'): Promise<void> {
      await db
        .update(vendorProfiles)
        .set({ kycTier: tier })
        .where(eq(vendorProfiles.userId, 'u_vendor_edit'))
    }

    async function setStatus(
      status: 'draft' | 'pending_review' | 'published' | 'paused',
    ): Promise<void> {
      await db
        .update(experiences)
        .set({ status })
        .where(eq(experiences.id, experienceId))
    }

    it('allows an over-cap edit while the listing is still a draft', async () => {
      await setVendorTier('identity')
      await setStatus('draft')

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          pricePerPerson_1_2: 9000,
          pricePerPerson_3_5: 9000,
          pricePerPerson_6_plus: 9000,
        }),
      )
      expect(result).toEqual({ ok: true })
    })

    it('blocks an over-price edit of a published listing for an identity Vendor', async () => {
      await setVendorTier('identity')
      await setStatus('published')

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          pricePerPerson_1_2: 9000,
          pricePerPerson_3_5: 9000,
          pricePerPerson_6_plus: 9000,
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/5000|per person/i)
      }

      // The over-cap price was NOT persisted.
      const [exp] = await db
        .select({ price: experiences.pricePerPerson_1_2 })
        .from(experiences)
        .where(eq(experiences.id, experienceId))
      expect(exp?.price).toBe('1500.00')
    })

    it('writes a vendor.experience.tier_cap_rejected audit row when an over-cap edit of a published listing is blocked (ADR-0007)', async () => {
      await setVendorTier('identity')
      await setStatus('published')

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          pricePerPerson_1_2: 9000,
          pricePerPerson_3_5: 9000,
          pricePerPerson_6_plus: 9000,
        }),
      )
      expect(result.ok).toBe(false)

      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, experienceId))
      const rejection = logs.find(
        (l) => l.action === 'vendor.experience.tier_cap_rejected',
      )
      expect(rejection).toBeDefined()
      expect(rejection?.entityType).toBe('experience')
      expect(rejection?.actorUserId).toBe('u_vendor_edit')
      expect((rejection?.payload as { code?: string }).code).toBe('PRICE_OVER_CAP')
    })

    it('blocks turning a published listing into a combo for an identity Vendor', async () => {
      await setVendorTier('identity')
      await setStatus('published')

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({ isCombo: true }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/combo/i)
      }
    })

    it('allows a within-cap edit of a published listing for an identity Vendor', async () => {
      await setVendorTier('identity')
      await setStatus('published')

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          pricePerPerson_1_2: 5000,
          pricePerPerson_3_5: 4500,
          pricePerPerson_6_plus: 4000,
          isCombo: false,
        }),
      )
      expect(result).toEqual({ ok: true })
    })

    it('allows any edit of a published listing for a business Vendor', async () => {
      await setVendorTier('business')
      await setStatus('published')

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          pricePerPerson_1_2: 99000,
          pricePerPerson_3_5: 99000,
          pricePerPerson_6_plus: 99000,
        }),
      )
      expect(result).toEqual({ ok: true })
    })
  })

  // ── ADR-0013 search re-index on edit ──────────────────────────────
  //
  // A published Experience is the canonical search row (ADR-0013). When a
  // Vendor edits a PUBLISHED listing, the Meilisearch document must be
  // re-indexed so the facet fields (title, price, activity/region, combo)
  // stay in sync with the DB. Editing a non-searchable status (draft,
  // paused, archived) must NOT add a document to the index.
  describe('search re-index (ADR-0013)', () => {
    async function setVendorTier(tier: 'phone' | 'identity' | 'business'): Promise<void> {
      await db
        .update(vendorProfiles)
        .set({ kycTier: tier })
        .where(eq(vendorProfiles.userId, 'u_vendor_edit'))
    }

    async function setStatus(
      status: 'draft' | 'pending_review' | 'published' | 'paused',
    ): Promise<void> {
      await db
        .update(experiences)
        .set({ status })
        .where(eq(experiences.id, experienceId))
    }

    it('re-indexes a published listing into Meilisearch with the updated facet fields', async () => {
      await setVendorTier('business')
      await setStatus('published')
      const { client, addCalls } = makeSearchStub()

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          title: 'Reindexed Title',
          activitySlug: 'paragliding',
          regionSlug: 'manali',
          pricePerPerson_1_2: 4200,
          pricePerPerson_3_5: 4000,
          pricePerPerson_6_plus: 3800,
          isCombo: false,
        }),
        { searchClient: client },
      )

      expect(result).toEqual({ ok: true })
      expect(addCalls).toHaveLength(1)
      const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
      expect(doc.id).toBe(experienceId)
      expect(doc.title).toBe('Reindexed Title')
      expect(doc.slug).toBe('edit-test-exp')
      expect(doc.activitySlug).toBe('paragliding')
      expect(doc.regionSlug).toBe('manali')
      expect(doc.vendorSlug).toBe('edit-test-vendor')
      // Highest bracket governs the search facet price (integer rupees).
      expect(doc.pricePerPersonRupees).toBe(4200)
      expect(doc.isCombo).toBe(false)
    })

    it('does NOT add a document to the index when editing a draft listing', async () => {
      await setVendorTier('business')
      await setStatus('draft')
      const { client, addCalls } = makeSearchStub()

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput(),
        { searchClient: client },
      )

      expect(result).toEqual({ ok: true })
      expect(addCalls).toHaveLength(0)
    })

    it('does NOT re-index when a published edit is rejected by the tier cap', async () => {
      await setVendorTier('identity')
      await setStatus('published')
      const { client, addCalls } = makeSearchStub()

      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        validInput({
          pricePerPerson_1_2: 9000,
          pricePerPerson_3_5: 9000,
          pricePerPerson_6_plus: 9000,
        }),
        { searchClient: client },
      )

      expect(result.ok).toBe(false)
      expect(addCalls).toHaveLength(0)
    })
  })

  // ── ADR-0017 structured attributes + itinerary persistence (issue 05) ─
  //
  // The edit form now OWNS the structured scalar/array facets and the
  // Vendor-authored itinerary. They must persist on the experiences row +
  // experience_itinerary_steps atomically, validate through the shared Zod
  // bounds, and feed the search document from the NEWLY-SAVED values.
  describe('structured attributes (ADR-0017)', () => {
    function structuredInput(
      overrides: Partial<UpdateExperienceInput> = {},
    ): UpdateExperienceInput {
      return validInput({
        difficulty: 'challenging',
        durationMinutes: 240,
        minAge: 12,
        maxGroupSize: 8,
        languages: ['en', 'hi'],
        meetingPoint: 'Shivpuri taxi stand, Rishikesh',
        seasonMonths: [9, 10, 11],
        highlights: ['Grade III+ rapids', 'Riverside lunch'],
        inclusions: ['Guide', 'Safety gear'],
        exclusions: ['Transport', 'Tips'],
        whatToBring: ['Swimwear', 'Towel'],
        itinerary: [
          { title: 'Safety briefing', description: 'Gear up', dayOffset: 0, durationMinutes: 30 },
          { title: 'On the water', description: 'The 16km stretch', dayOffset: 0, durationMinutes: 180 },
        ],
        ...overrides,
      })
    }

    it('persists all structured scalar/array fields on the experience row', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput(),
      )
      expect(result).toEqual({ ok: true })

      const [updated] = await db
        .select()
        .from(experiences)
        .where(eq(experiences.id, experienceId))

      expect(updated.difficulty).toBe('challenging')
      expect(updated.durationMinutes).toBe(240)
      expect(updated.minAge).toBe(12)
      expect(updated.maxGroupSize).toBe(8)
      expect(updated.languages).toEqual(['en', 'hi'])
      expect(updated.meetingPoint).toBe('Shivpuri taxi stand, Rishikesh')
      expect(updated.seasonMonths).toEqual([9, 10, 11])
      expect(updated.highlights).toEqual(['Grade III+ rapids', 'Riverside lunch'])
      expect(updated.inclusions).toEqual(['Guide', 'Safety gear'])
      expect(updated.exclusions).toEqual(['Transport', 'Tips'])
      expect(updated.whatToBring).toEqual(['Swimwear', 'Towel'])
    })

    it('replaces the itinerary, ordered by stepOrder', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput(),
      )
      expect(result).toEqual({ ok: true })

      const steps = await loadItinerary(db, experienceId)
      expect(steps).toHaveLength(2)
      expect(steps.map((s) => s.title)).toEqual(['Safety briefing', 'On the water'])
      expect(steps[0]!.stepOrder).toBe(0)
      expect(steps[1]!.stepOrder).toBe(1)
      expect(steps[1]!.durationMinutes).toBe(180)
    })

    it('replaces the itinerary idempotently on a second edit (no orphan steps)', async () => {
      await executeUpdateExperience(db, 'u_vendor_edit', structuredInput())
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({ itinerary: [{ title: 'Single step' }] }),
      )
      expect(result).toEqual({ ok: true })

      const steps = await loadItinerary(db, experienceId)
      expect(steps).toHaveLength(1)
      expect(steps[0]!.title).toBe('Single step')
    })

    it('clears the itinerary when an empty array is provided', async () => {
      await executeUpdateExperience(db, 'u_vendor_edit', structuredInput())
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({ itinerary: [] }),
      )
      expect(result).toEqual({ ok: true })

      const steps = await loadItinerary(db, experienceId)
      expect(steps).toHaveLength(0)
    })

    it('rejects too many highlights via the shared Zod schema', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({
          highlights: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Validation failed.')
        expect(result.fieldErrors?.highlights).toBeDefined()
      }
    })

    it('rejects an out-of-range season month', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({ seasonMonths: [13] }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.fieldErrors?.['seasonMonths.0']).toBeDefined()
      }
    })

    it('rejects an invalid difficulty enum', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({ difficulty: 'insane' as unknown as 'easy' }),
      )
      expect(result.ok).toBe(false)
    })

    it('rejects a duration below the minimum', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({ durationMinutes: 5 }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.fieldErrors?.durationMinutes).toBeDefined()
      }
    })

    it('rejects an itinerary step with an empty title', async () => {
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({ itinerary: [{ title: '' }] }),
      )
      expect(result.ok).toBe(false)
    })

    it('builds the search doc from the NEW structured values, not the existing row', async () => {
      // Seed the existing row with stale facets so we can prove the doc is
      // built from the edit input, not the pre-edit DB row.
      await db
        .update(experiences)
        .set({
          status: 'published',
          difficulty: 'easy',
          durationMinutes: 60,
          maxGroupSize: 2,
          seasonMonths: [1],
        })
        .where(eq(experiences.id, experienceId))
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'business' })
        .where(eq(vendorProfiles.userId, 'u_vendor_edit'))

      const { client, addCalls } = makeSearchStub()
      const result = await executeUpdateExperience(
        db,
        'u_vendor_edit',
        structuredInput({
          difficulty: 'extreme',
          durationMinutes: 480,
          maxGroupSize: 6,
          seasonMonths: [6, 7, 8],
        }),
        { searchClient: client },
      )

      expect(result).toEqual({ ok: true })
      expect(addCalls).toHaveLength(1)
      const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
      expect(doc.difficulty).toBe('extreme')
      expect(doc.durationMinutes).toBe(480)
      expect(doc.maxGroupSize).toBe(6)
      expect(doc.seasonMonths).toEqual([6, 7, 8])
    })
  })
})
