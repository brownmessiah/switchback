import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeUpdateExperience,
  type UpdateExperienceInput,
} from './actions'

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
})
