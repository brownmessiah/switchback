import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { slugRedirects } from '@/db/schema/slug-redirects'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadExperienceDetail } from './detail-loader'

describe('Experience detail loader (ADR-0013)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_vendor', email: 'vendor@test.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Rishikesh Adventures',
      slug: 'rishikesh-adventures',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE slug_redirects CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seedExperience(overrides: Partial<{
    slug: string
    title: string
    activitySlug: string
    regionSlug: string
    status: 'published' | 'draft' | 'paused' | 'archived'
    requiredPermits: string[]
    shortDescription: string | null
    longDescription: string | null
  }> = {}): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: overrides.slug ?? 'grand-rafting-trip',
        title: overrides.title ?? 'Grand Rafting Trip',
        shortDescription: overrides.shortDescription ?? 'A thrilling rafting experience',
        longDescription: overrides.longDescription ?? 'Detailed description of the rafting trip.',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2200.00',
        pricePerPerson_6_plus: '1900.00',
        regionSlug: overrides.regionSlug ?? 'rishikesh',
        activitySlug: overrides.activitySlug ?? 'rafting',
        status: overrides.status ?? 'published',
        requiredPermits: overrides.requiredPermits ?? [],
      })
      .returning({ id: experiences.id })
    return exp!.id
  }

  // ---- Tracer bullet: happy path ----
  it('returns a fully-hydrated Experience for a published slug', async () => {
    await seedExperience({ slug: 'grand-rafting-trip' })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'grand-rafting-trip' })

    expect(result).not.toBeNull()
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')

    const detail = result!.data
    expect(detail.slug).toBe('grand-rafting-trip')
    expect(detail.title).toBe('Grand Rafting Trip')
    expect(detail.shortDescription).toBe('A thrilling rafting experience')
    expect(detail.longDescription).toBe('Detailed description of the rafting trip.')

    // Vendor metadata
    expect(detail.vendor.businessName).toBe('Rishikesh Adventures')
    expect(detail.vendor.slug).toBe('rishikesh-adventures')

    // Registry metadata
    expect(detail.activity.slug).toBe('rafting')
    expect(detail.activity.displayName.en).toBeTruthy()
    expect(detail.region.slug).toBe('rishikesh')
    expect(detail.region.displayName.en).toBeTruthy()

    // Pricing brackets
    expect(detail.pricePerPerson_1_2).toBe(2500)
    expect(detail.pricePerPerson_3_5).toBe(2200)
    expect(detail.pricePerPerson_6_plus).toBe(1900)

    // Cancellation + payment
    expect(detail.cancellationPreset).toBe('flexible')
    expect(detail.paymentModesAllowed).toContain('full_upfront')
  })

  // ---- Slug not found → null ----
  it('returns null when no experience or redirect matches the slug', async () => {
    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'nonexistent-slug' })
    expect(result).toBeNull()
  })

  // ---- Draft / paused / archived experiences excluded ----
  it('returns null for a draft experience', async () => {
    await seedExperience({ slug: 'draft-exp', status: 'draft' })
    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'draft-exp' })
    expect(result).toBeNull()
  })

  it('returns null for a paused experience', async () => {
    await seedExperience({ slug: 'paused-exp', status: 'paused' })
    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'paused-exp' })
    expect(result).toBeNull()
  })

  it('returns null for an archived experience', async () => {
    await seedExperience({ slug: 'archived-exp', status: 'archived' })
    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'archived-exp' })
    expect(result).toBeNull()
  })

  // ---- Slug redirect → { type: 'redirect', canonicalSlug } ----
  it('returns a redirect when the slug matches a slug_redirects row', async () => {
    const expId = await seedExperience({ slug: 'new-rafting-slug' })
    await db.insert(slugRedirects).values({
      entityType: 'experience',
      entityId: expId,
      oldSlug: 'old-rafting-slug',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'old-rafting-slug' })

    expect(result).not.toBeNull()
    expect(result!.type).toBe('redirect')
    if (result!.type !== 'redirect') throw new Error('unreachable')
    expect(result!.canonicalSlug).toBe('new-rafting-slug')
  })

  // ---- Redirect to a non-published experience → null (don't redirect to drafts) ----
  it('returns null when slug_redirect points to a non-published experience', async () => {
    const expId = await seedExperience({ slug: 'draft-target', status: 'draft' })
    await db.insert(slugRedirects).values({
      entityType: 'experience',
      entityId: expId,
      oldSlug: 'old-slug-to-draft',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'old-slug-to-draft' })
    expect(result).toBeNull()
  })

  // ---- Required permits populated ----
  it('includes required permits when the experience has them', async () => {
    await seedExperience({
      slug: 'arunachal-trek',
      activitySlug: 'trekking',
      regionSlug: 'manali',
      requiredPermits: ['ilp_arunachal_pradesh'],
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'arunachal-trek' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.requiredPermits).toEqual(['ilp_arunachal_pradesh'])
  })

  it('returns empty permits array when experience has none', async () => {
    await seedExperience({ slug: 'no-permit-exp', requiredPermits: [] })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'no-permit-exp' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.requiredPermits).toEqual([])
  })

  // ---- Permit registry surfacing (ADR-0011 Permits panel) ----
  it('surfaces resolved permit metadata for the Permits panel, not just slugs', async () => {
    // The Experience stores controlled slugs; the loader resolves them
    // against lib/permits/registry.ts so the Booking Permits panel can
    // render authority/URL/cost without the page knowing the catalogue.
    await seedExperience({
      slug: 'sikkim-corbett-combo-route',
      activitySlug: 'trekking',
      regionSlug: 'manali',
      requiredPermits: ['ilp_sikkim', 'wildlife_corbett'],
    })

    const result = await loadExperienceDetail(db, {
      lng: 'en',
      slug: 'sikkim-corbett-combo-route',
    })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')

    // Raw slugs still present for backward compatibility.
    expect(result!.data.requiredPermits).toEqual(['ilp_sikkim', 'wildlife_corbett'])
    // Resolved metadata in listed order with real catalogue values.
    expect(result!.data.permits.map((p) => p.slug)).toEqual([
      'ilp_sikkim',
      'wildlife_corbett',
    ])
    expect(result!.data.permits[0]?.authority).toMatch(/Sikkim/i)
    expect(result!.data.permits[0]?.officialUrl).toMatch(/^https?:\/\//)
    expect(result!.data.permits[1]?.name).toMatch(/Corbett/i)
  })

  it('returns an empty permits panel for an Experience with no required permits', async () => {
    await seedExperience({ slug: 'no-permit-panel-exp', requiredPermits: [] })

    const result = await loadExperienceDetail(db, {
      lng: 'en',
      slug: 'no-permit-panel-exp',
    })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.permits).toEqual([])
  })

  // ---- Next available slot (revenue-spine wiring, Issue #13) ----
  it('surfaces the earliest open availability slot id for the Book-now link', async () => {
    const expId = await seedExperience({ slug: 'rafting-with-slots' })

    const later = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    const earlier = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    // Insert later-first to prove ordering by start_at, not insert order.
    await db.insert(availabilitySlots).values([
      {
        experienceId: expId,
        startAt: later,
        endAt: new Date(later.getTime() + 4 * 60 * 60 * 1000),
        capacity: 8,
      },
    ])
    const [earlierSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: expId,
        startAt: earlier,
        endAt: new Date(earlier.getTime() + 4 * 60 * 60 * 1000),
        capacity: 8,
      })
      .returning({ id: availabilitySlots.id })

    const result = await loadExperienceDetail(db, {
      lng: 'en',
      slug: 'rafting-with-slots',
    })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.nextAvailableSlotId).toBe(earlierSlot!.id)
  })

  it('skips sold-out and closed slots when picking the next available one', async () => {
    const expId = await seedExperience({ slug: 'rafting-soldout-first' })

    const soonest = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const next = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000)
    await db.insert(availabilitySlots).values([
      {
        experienceId: expId,
        startAt: soonest,
        endAt: new Date(soonest.getTime() + 4 * 60 * 60 * 1000),
        capacity: 4,
        capacityTaken: 4,
        status: 'sold_out',
      },
    ])
    const [openSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: expId,
        startAt: next,
        endAt: new Date(next.getTime() + 4 * 60 * 60 * 1000),
        capacity: 8,
        status: 'open',
      })
      .returning({ id: availabilitySlots.id })

    const result = await loadExperienceDetail(db, {
      lng: 'en',
      slug: 'rafting-soldout-first',
    })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.nextAvailableSlotId).toBe(openSlot!.id)
  })

  it('returns null nextAvailableSlotId when no open slot exists', async () => {
    await seedExperience({ slug: 'rafting-no-slots' })

    const result = await loadExperienceDetail(db, {
      lng: 'en',
      slug: 'rafting-no-slots',
    })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.nextAvailableSlotId).toBeNull()
  })

  // ---- Locale passthrough ----
  it('passes the lng field through in the result', async () => {
    await seedExperience({ slug: 'hindi-exp' })

    const result = await loadExperienceDetail(db, { lng: 'hi', slug: 'hindi-exp' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.lng).toBe('hi')
  })
})
