import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadRecentlyViewedCards } from './loader'

/**
 * The recently-viewed rail is driven by slugs that come from the visitor's
 * localStorage — completely outside the DB's control. The loader is the gate
 * that turns those raw slugs into renderable cards, and MUST route them through
 * `lib/experiences/public-filter` so a stale slug that is now draft / paused /
 * archived / fixture NEVER renders (guardrail D0). It must also preserve the
 * caller's recency order (most-recent-first) rather than the DB's natural order.
 */
describe('loadRecentlyViewedCards (PGlite, public-filter gated)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([{ id: 'u_v', email: 'vendor@test.com', name: 'Vendor' }])
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
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seed(
    slug: string,
    status: 'published' | 'draft' | 'paused' | 'archived',
  ): Promise<void> {
    await db.insert(experiences).values({
      vendorUserId: 'u_v',
      slug,
      title: `Title for ${slug}`,
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status,
    })
  }

  it('returns [] for an empty slug list (rail hidden when nothing stored)', async () => {
    expect(await loadRecentlyViewedCards(db, [])).toEqual([])
  })

  it('returns a published Experience as a card', async () => {
    await seed('rafting-a', 'published')
    const cards = await loadRecentlyViewedCards(db, ['rafting-a'])
    expect(cards).toHaveLength(1)
    expect(cards[0]!.slug).toBe('rafting-a')
    expect(cards[0]!.title).toBe('Title for rafting-a')
    expect(cards[0]!.pricePerParticipantRupees).toBe(1500)
  })

  it('preserves the caller-supplied recency order (most-recent-first)', async () => {
    await seed('rafting-a', 'published')
    await seed('rafting-b', 'published')
    await seed('rafting-c', 'published')
    // Visitor viewed c, then a, then b last → input order is b, a, c.
    const cards = await loadRecentlyViewedCards(db, ['rafting-b', 'rafting-a', 'rafting-c'])
    expect(cards.map((c) => c.slug)).toEqual(['rafting-b', 'rafting-a', 'rafting-c'])
  })

  it('excludes non-published Experiences (draft / paused / archived)', async () => {
    await seed('pub', 'published')
    await seed('draft', 'draft')
    await seed('paused', 'paused')
    await seed('archived', 'archived')
    const cards = await loadRecentlyViewedCards(db, ['draft', 'pub', 'paused', 'archived'])
    expect(cards.map((c) => c.slug)).toEqual(['pub'])
  })

  it('excludes published-but-fixture Experiences (never leak to public rail)', async () => {
    await seed('pub', 'published')
    // A published fixture slug from FIXTURE_EXPERIENCE_SLUGS.
    await seed('commission-scope-fixture-bir-billing', 'published')
    const cards = await loadRecentlyViewedCards(db, [
      'commission-scope-fixture-bir-billing',
      'pub',
    ])
    expect(cards.map((c) => c.slug)).toEqual(['pub'])
  })

  it('ignores unknown / stale slugs that no longer exist', async () => {
    await seed('pub', 'published')
    const cards = await loadRecentlyViewedCards(db, ['ghost', 'pub', 'also-gone'])
    expect(cards.map((c) => c.slug)).toEqual(['pub'])
  })

  it('caps the number of resolved cards to maxItems, preserving order', async () => {
    for (let i = 0; i < 10; i++) await seed(`exp-${i}`, 'published')
    const slugs = Array.from({ length: 10 }, (_, i) => `exp-${i}`)
    const cards = await loadRecentlyViewedCards(db, slugs, 4)
    expect(cards.map((c) => c.slug)).toEqual(['exp-0', 'exp-1', 'exp-2', 'exp-3'])
  })
})
