import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiGenerations } from '@/db/schema/ai-generations'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import type { ItineraryItemDraft } from './trip-planner'

// The Claude client lives behind a thin, mockable module. The trip-planner
// core imports `generateItineraryDraft` from it; we replace that with a fake
// so no network call is made and we control exactly what the "model" returns
// (including a deliberately HALLUCINATED experience_id) — per the AC.
const generateItineraryDraftMock = vi.fn()

vi.mock('./claude-client', () => ({
  isClaudeConfigured: () => generateItineraryDraftMock.getMockImplementation() != null,
  generateItineraryDraft: (...args: unknown[]) => generateItineraryDraftMock(...args),
}))

import { generateItinerary } from './trip-planner'

describe('AI trip planner — RAG-grounded itinerary (ADR-0010)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let publishedIds: string[]

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([{ id: 'u_vendor', email: 'vendor@test.com' }])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Rishikesh Adventures',
      slug: 'rishikesh-adventures',
      pan: 'ABCDE1234F',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ai_generations CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
    generateItineraryDraftMock.mockReset()

    const rows = await db
      .insert(experiences)
      .values([
        {
          vendorUserId: 'u_vendor',
          slug: 'white-water-rafting',
          title: 'White Water Rafting',
          shortDescription: 'Grade III+ rapids',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '2000.00',
          pricePerPerson_3_5: '1800.00',
          pricePerPerson_6_plus: '1500.00',
          regionSlug: 'rishikesh',
          activitySlug: 'rafting',
          status: 'published',
        },
        {
          vendorUserId: 'u_vendor',
          slug: 'sunrise-trek',
          title: 'Sunrise Himalayan Trek',
          shortDescription: 'Dawn ridge walk',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '1200.00',
          pricePerPerson_3_5: '1100.00',
          pricePerPerson_6_plus: '900.00',
          regionSlug: 'rishikesh',
          activitySlug: 'trekking',
          status: 'published',
        },
        // A DRAFT experience that must never be retrieved/recommended.
        {
          vendorUserId: 'u_vendor',
          slug: 'secret-draft-bungee',
          title: 'Unpublished Bungee',
          shortDescription: 'Not live yet',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '3000.00',
          pricePerPerson_3_5: '2800.00',
          pricePerPerson_6_plus: '2500.00',
          regionSlug: 'rishikesh',
          activitySlug: 'bungee-jumping',
          status: 'draft',
        },
      ])
      .returning({ id: experiences.id, status: experiences.status })

    publishedIds = rows.filter((r) => r.status === 'published').map((r) => r.id)
  })

  const input = {
    region: 'rishikesh',
    activity: undefined as string | undefined,
    days: 2,
    budgetRupees: 10000,
    groupSize: 2,
    travelStyle: 'adventure' as const,
  }

  it('drops a hallucinated experience_id not in the retrieval set (Claude path)', async () => {
    // The mocked model returns two grounded items AND one fabricated id.
    generateItineraryDraftMock.mockImplementation(
      async ({ retrievalSet }: { retrievalSet: { id: string }[] }): Promise<{
        days: { dayNumber: number; title: string; items: ItineraryItemDraft[] }[]
        packingList: string[]
      }> => {
        const real = retrievalSet.map((e) => e.id)
        return {
          days: [
            {
              dayNumber: 1,
              title: 'Arrival & Rapids',
              items: [
                { experienceId: real[0]!, rationale: 'Iconic rafting start.' },
                {
                  experienceId: '00000000-0000-0000-0000-000000000000',
                  rationale: 'Hallucinated zipline that does not exist.',
                },
              ],
            },
            {
              dayNumber: 2,
              title: 'Mountain Dawn',
              items: [{ experienceId: real[1]!, rationale: 'Sunrise ridge trek.' }],
            },
          ],
          packingList: ['Quick-dry clothes', 'Trekking shoes', 'Sunscreen'],
        }
      },
    )

    const result = await generateItinerary(db, input, { requestedByUserId: null })

    const recommendedIds = result.days.flatMap((d) => d.items.map((i) => i.experienceId))
    // Only grounded ids survive; the fabricated one is dropped at the response layer.
    expect(recommendedIds).not.toContain('00000000-0000-0000-0000-000000000000')
    expect(recommendedIds.every((id) => publishedIds.includes(id))).toBe(true)
    expect(recommendedIds.length).toBe(2)
    // Every surviving item carries the real slug so the UI can link to the PDP.
    for (const day of result.days) {
      for (const item of day.items) {
        expect(item.slug).toBeTruthy()
        expect(item.title).toBeTruthy()
      }
    }
    expect(result.packingList.length).toBeGreaterThan(0)
    expect(result.aiAssisted).toBe(true)
  })

  it('writes an ai_generations provenance row with retrievalSet + citationTraces (Claude path)', async () => {
    generateItineraryDraftMock.mockImplementation(
      async ({ retrievalSet }: { retrievalSet: { id: string }[] }) => ({
        days: [
          {
            dayNumber: 1,
            title: 'Day one',
            items: [
              { experienceId: retrievalSet[0]!.id, rationale: 'Start strong.' },
              { experienceId: 'nope-not-real', rationale: 'fabricated' },
            ],
          },
        ],
        packingList: ['Water bottle'],
      }),
    )

    await generateItinerary(db, input, { requestedByUserId: null })

    const rows = await db.select().from(aiGenerations)
    expect(rows.length).toBe(1)
    const row = rows[0]!
    expect(row.surface).toBe('trip_planner')
    expect(row.model).toBeTruthy()
    expect(row.modelVersion).toBeTruthy()
    expect(row.promptTemplateHash).toBeTruthy()
    expect(row.inputFingerprint).toBeTruthy()

    // retrievalSet = candidate experience IDs that were offered to the model.
    const retrieval = row.retrievalSet as string[]
    expect(retrieval.length).toBeGreaterThanOrEqual(2)
    expect(retrieval.every((id) => publishedIds.includes(id))).toBe(true)

    // citationTraces = the grounded IDs actually cited (hallucination excluded).
    const cited = row.citationTraces as string[]
    expect(cited).toContain(publishedIds[0])
    expect(cited).not.toContain('nope-not-real')
  })

  it('falls back to a deterministic, still-grounded itinerary when no key is configured', async () => {
    // No mock implementation set → isClaudeConfigured() returns false →
    // the deterministic RAG path is used.
    generateItineraryDraftMock.mockReset()

    const result = await generateItinerary(db, input, { requestedByUserId: null })

    const recommendedIds = result.days.flatMap((d) => d.items.map((i) => i.experienceId))
    expect(recommendedIds.length).toBeGreaterThan(0)
    // Deterministic path must still ONLY recommend grounded, published ids.
    expect(recommendedIds.every((id) => publishedIds.includes(id))).toBe(true)
    expect(generateItineraryDraftMock).not.toHaveBeenCalled()

    const rows = await db.select().from(aiGenerations)
    expect(rows.length).toBe(1)
    expect(rows[0]!.model).toBe('retrieval-deterministic-v1')
    expect(rows[0]!.surface).toBe('trip_planner')
    const cited = rows[0]!.citationTraces as string[]
    expect(cited.every((id) => publishedIds.includes(id))).toBe(true)
  })

  it('spreads recommendations across the requested number of days', async () => {
    generateItineraryDraftMock.mockReset()

    const result = await generateItinerary(
      db,
      { ...input, days: 2 },
      { requestedByUserId: null },
    )

    expect(result.days.length).toBe(2)
    expect(result.days.map((d) => d.dayNumber)).toEqual([1, 2])
  })
})
