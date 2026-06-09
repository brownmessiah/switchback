import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadSimilarExperiences } from './similar'

/**
 * "Similar experiences" mixes three intents while NEVER leaking a
 * non-publicly-visible Experience (guardrail D0): every intent group is gated
 * through `lib/experiences/public-filter` (`status='published'` AND
 * non-fixture). The three intents are:
 *   (a) SAME activity, DIFFERENT region — prefer same-state regions ("nearby"
 *       is honestly modelled as same Indian state; there are no coordinates so
 *       no distance is fabricated).
 *   (b) SAME region, DIFFERENT activity.
 *   (c) Beginner-friendly (difficulty='easy') alternatives ordered by REAL
 *       demand (confirmed/awaiting_completion/completed bookings).
 * The merged result excludes the current Experience, dedupes, and caps.
 */
describe('loadSimilarExperiences (PGlite, 3-intent, public-filter gated)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'vendor@test.com', name: 'Vendor' },
      { id: 'u_c', email: 'customer@test.com', name: 'Customer' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v',
        businessName: 'Test Adventures',
        slug: 'test-adventures',
        responseTimeSlaScore: '100.00',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE bookings, availability_slots, experiences CASCADE`,
    )
  })

  // Monotonic offset so each seeded slot gets a unique start_at per experience
  // (availability_slots has a UNIQUE (experience_id, start_at) constraint).
  let slotSeq = 0

  interface SeedOpts {
    slug: string
    regionSlug: string
    activitySlug: string
    status?: 'published' | 'draft' | 'paused' | 'archived'
    difficulty?: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
  }

  async function seed(opts: SeedOpts): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: opts.slug,
        title: `Title for ${opts.slug}`,
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: opts.regionSlug,
        activitySlug: opts.activitySlug,
        difficulty: opts.difficulty ?? null,
        status: opts.status ?? 'published',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  async function addDemand(experienceId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      slotSeq += 1
      const startAt = new Date(Date.now() + slotSeq * 24 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })
      await db.insert(bookings).values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'completed',
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
    }
  }

  /**
   * The canonical scenario from issue 16: a Rishikesh rafting PDP. Same state =
   * Uttarakhand (rishikesh, auli). Manali (Himachal) is a different state.
   */
  async function seedRishikeshRaftingScenario(): Promise<{ currentId: string }> {
    // The current Experience.
    const currentId = await seed({
      slug: 'rafting-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      difficulty: 'moderate',
    })
    // (a) same activity (rafting), different region, SAME state (auli/Uttarakhand).
    await seed({ slug: 'rafting-auli', regionSlug: 'auli', activitySlug: 'rafting' })
    // (a) same activity (rafting), different region, DIFFERENT state (manali/HP).
    await seed({ slug: 'rafting-manali', regionSlug: 'manali', activitySlug: 'rafting' })
    // (b) same region (rishikesh), different activity.
    await seed({ slug: 'bungee-rishikesh', regionSlug: 'rishikesh', activitySlug: 'bungee' })
    // (c) easy/beginner-friendly alternative elsewhere.
    const easyId = await seed({
      slug: 'camping-goa-easy',
      regionSlug: 'goa',
      activitySlug: 'camping',
      difficulty: 'easy',
    })
    await addDemand(easyId, 4)
    // Noise that MUST be excluded: a draft + a published fixture, both in a
    // matching region/activity so they would otherwise qualify for an intent.
    await seed({
      slug: 'rafting-rishikesh-draft',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'draft',
    })
    await seed({
      // A real published fixture slug from FIXTURE_EXPERIENCE_SLUGS, same region.
      slug: 'refund-queue-fixture-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'published',
    })
    return { currentId }
  }

  async function loadFor(currentId: string) {
    return loadSimilarExperiences(db, {
      id: currentId,
      slug: 'rafting-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
  }

  it('returns [] when there are no other published Experiences', async () => {
    const currentId = await seed({
      slug: 'rafting-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
    expect(await loadFor(currentId)).toEqual([])
  })

  it('represents all three intent groups', async () => {
    const { currentId } = await seedRishikeshRaftingScenario()
    const slugs = (await loadFor(currentId)).map((c) => c.slug)
    // (a) same activity, different region (same-state preferred).
    expect(slugs).toContain('rafting-auli')
    // (b) same region, different activity.
    expect(slugs).toContain('bungee-rishikesh')
    // (c) easy/beginner-friendly alternative.
    expect(slugs).toContain('camping-goa-easy')
  })

  it('prefers a same-state region for the same-activity intent (honest "nearby")', async () => {
    const { currentId } = await seedRishikeshRaftingScenario()
    const slugs = (await loadFor(currentId)).map((c) => c.slug)
    const auliIdx = slugs.indexOf('rafting-auli')
    const manaliIdx = slugs.indexOf('rafting-manali')
    // Same-state (auli/Uttarakhand) ranks ahead of out-of-state (manali/HP).
    expect(auliIdx).toBeGreaterThanOrEqual(0)
    if (manaliIdx >= 0) {
      expect(auliIdx).toBeLessThan(manaliIdx)
    }
  })

  it('EXCLUDES the current Experience', async () => {
    const { currentId } = await seedRishikeshRaftingScenario()
    const slugs = (await loadFor(currentId)).map((c) => c.slug)
    expect(slugs).not.toContain('rafting-rishikesh')
  })

  it('EXCLUDES draft and published-fixture Experiences (no D0 leak)', async () => {
    const { currentId } = await seedRishikeshRaftingScenario()
    const slugs = (await loadFor(currentId)).map((c) => c.slug)
    expect(slugs).not.toContain('rafting-rishikesh-draft')
    expect(slugs).not.toContain('refund-queue-fixture-rishikesh')
  })

  it('dedupes an Experience that matches more than one intent', async () => {
    const currentId = await seed({
      slug: 'rafting-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
    // Same region (rishikesh) AND beginner-friendly (easy) → matches intent (b)
    // and intent (c). It must appear exactly once.
    await seed({
      slug: 'easy-kayak-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'kayaking',
      difficulty: 'easy',
    })
    const slugs = (await loadFor(currentId)).map((c) => c.slug)
    expect(slugs.filter((s) => s === 'easy-kayak-rishikesh')).toHaveLength(1)
  })

  it('caps the merged result to the requested maximum', async () => {
    const currentId = await seed({
      slug: 'rafting-rishikesh',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
    // 12 same-region different-activity candidates.
    for (let i = 0; i < 12; i++) {
      await seed({
        slug: `other-rishikesh-${i}`,
        regionSlug: 'rishikesh',
        activitySlug: `act-${i}`,
      })
    }
    const cards = await loadSimilarExperiences(
      db,
      {
        id: currentId,
        slug: 'rafting-rishikesh',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      },
      4,
    )
    expect(cards).toHaveLength(4)
  })

  it('returns enriched ExperienceCardData (card shape + demand-derived highlight)', async () => {
    const { currentId } = await seedRishikeshRaftingScenario()
    const cards = await loadFor(currentId)
    const card = cards.find((c) => c.slug === 'rafting-auli')
    expect(card).toBeDefined()
    expect(card!.title).toBe('Title for rafting-auli')
    expect(card!.pricePerParticipantRupees).toBe(1500)
    expect(card!.regionSlug).toBe('auli')
    expect(card!.activitySlug).toBe('rafting')
    // Enrichment fields are present (issue 05 trust + social proof shape).
    expect(card).toHaveProperty('highlight')
  })
})
