import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experienceItinerarySteps } from '@/db/schema/experience-itinerary-steps'
import { experiences } from '@/db/schema/experiences'
import { mediaAssets } from '@/db/schema/media-assets'
import { regionClosures } from '@/db/schema/region-closures'
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
    await db.execute(sql`TRUNCATE TABLE region_closures CASCADE`)
    await db.execute(sql`TRUNCATE TABLE slug_redirects CASCADE`)
    await db.execute(sql`TRUNCATE TABLE media_assets CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experience_itinerary_steps CASCADE`)
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
    durationMinutes: number | null
    difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
    minAge: number | null
    maxGroupSize: number | null
    languages: string[]
    meetingPoint: string | null
    seasonMonths: number[]
    highlights: string[]
    inclusions: string[]
    exclusions: string[]
    whatToBring: string[]
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
        durationMinutes: overrides.durationMinutes ?? null,
        difficulty: overrides.difficulty ?? null,
        minAge: overrides.minAge ?? null,
        maxGroupSize: overrides.maxGroupSize ?? null,
        languages: overrides.languages,
        meetingPoint: overrides.meetingPoint ?? null,
        seasonMonths: overrides.seasonMonths,
        highlights: overrides.highlights,
        inclusions: overrides.inclusions,
        exclusions: overrides.exclusions,
        whatToBring: overrides.whatToBring,
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

  // ---- Gallery from media_assets (parity-catchup/02) ----
  it('hydrates the gallery from the Experience media_assets, cover first', async () => {
    const id = await seedExperience({ slug: 'gallery-exp' })
    await db.insert(mediaAssets).values([
      { uploadedBy: 'u_vendor', storageKey: 'm/2.jpg', url: 'https://cdn/2.jpg', contentType: 'image/jpeg', sizeBytes: 100, altText: 'two', entityType: 'experience', entityId: id },
      { uploadedBy: 'u_vendor', storageKey: 'm/1.jpg', url: 'https://cdn/1.jpg', contentType: 'image/jpeg', sizeBytes: 100, altText: 'one', entityType: 'experience', entityId: id },
    ])

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'gallery-exp' })
    if (result?.type !== 'found') throw new Error('expected found')
    expect(result.data.gallery.map((g) => g.url)).toEqual(['https://cdn/1.jpg', 'https://cdn/2.jpg'])
    expect(result.data.gallery[0]).toMatchObject({ url: 'https://cdn/1.jpg', altText: 'one' })
  })

  it('returns an empty gallery when the Experience has no media_assets', async () => {
    await seedExperience({ slug: 'no-gallery-exp' })
    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'no-gallery-exp' })
    if (result?.type !== 'found') throw new Error('expected found')
    expect(result.data.gallery).toEqual([])
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

  // ---- Region closure surfacing (ADR-0011 inline closure notice) ----
  it('surfaces an active region closure overlapping the booking window', async () => {
    await seedExperience({ slug: 'goa-dive-closed', regionSlug: 'goa' })

    // An admin monsoon closure on the "goa" region that is active right now.
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await db.insert(regionClosures).values({
      regionSlug: 'goa',
      startAt: start,
      endAt: end,
      reason: 'Closed for monsoon — reopens August',
      source: 'admin',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'goa-dive-closed' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')

    expect(result!.data.activeClosure).not.toBeNull()
    expect(result!.data.activeClosure!.reason).toBe('Closed for monsoon — reopens August')
    expect(result!.data.activeClosure!.endAt.getTime()).toBe(end.getTime())
  })

  it('surfaces an upcoming closure that falls inside the 90-day booking window', async () => {
    // Mirrors the slot materialiser, which skips dates inside a closure that
    // overlaps the rolling window even when it has not started yet — the
    // customer needs to know why those future dates are unbookable.
    await seedExperience({ slug: 'goa-dive-upcoming', regionSlug: 'goa' })

    const start = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
    const end = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000)
    await db.insert(regionClosures).values({
      regionSlug: 'goa',
      startAt: start,
      endAt: end,
      reason: 'Closed for monsoon — reopens later',
      source: 'admin',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'goa-dive-upcoming' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.activeClosure).not.toBeNull()
    expect(result!.data.activeClosure!.reason).toBe('Closed for monsoon — reopens later')
  })

  it('does not surface a closure beyond the 90-day booking window', async () => {
    await seedExperience({ slug: 'goa-dive-faraway', regionSlug: 'goa' })

    // Closure starts ~120 days out — outside the materialiser window, so the
    // bookable calendar is unaffected and no inline notice is shown.
    const start = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
    const end = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000)
    await db.insert(regionClosures).values({
      regionSlug: 'goa',
      startAt: start,
      endAt: end,
      reason: 'Far-future closure',
      source: 'admin',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'goa-dive-faraway' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.activeClosure).toBeNull()
  })

  it('does not surface a closure for a different region', async () => {
    await seedExperience({ slug: 'rishikesh-open', regionSlug: 'rishikesh' })

    await db.insert(regionClosures).values({
      regionSlug: 'goa',
      startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      reason: 'Goa monsoon',
      source: 'admin',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'rishikesh-open' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.activeClosure).toBeNull()
  })

  it('does not surface a closure that has already ended', async () => {
    await seedExperience({ slug: 'goa-reopened', regionSlug: 'goa' })

    await db.insert(regionClosures).values({
      regionSlug: 'goa',
      startAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      reason: 'Past monsoon',
      source: 'admin',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'goa-reopened' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.activeClosure).toBeNull()
  })

  it('returns null activeClosure when no closure exists for the region', async () => {
    await seedExperience({ slug: 'goa-no-closure', regionSlug: 'goa' })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'goa-no-closure' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    expect(result!.data.activeClosure).toBeNull()
  })

  // ---- Structured attributes + itinerary (ADR-0017) ----
  it('returns all structured fields and an ordered itinerary when present', async () => {
    const id = await seedExperience({
      slug: 'structured-rafting',
      durationMinutes: 180,
      difficulty: 'challenging',
      minAge: 12,
      maxGroupSize: 8,
      languages: ['en', 'hi'],
      meetingPoint: 'Shivpuri jetty',
      seasonMonths: [9, 10, 11],
      highlights: ['Grade III rapids', 'Riverside lunch'],
      inclusions: ['Guide', 'Safety gear'],
      exclusions: ['Transport'],
      whatToBring: ['Towel', 'Sunscreen'],
    })
    // Insert out of step_order to prove the loader orders by step_order.
    await db.insert(experienceItinerarySteps).values([
      { experienceId: id, stepOrder: 1, title: 'Rapids' },
      { experienceId: id, stepOrder: 0, title: 'Briefing' },
    ])

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'structured-rafting' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    const d = result!.data

    expect(d.durationMinutes).toBe(180)
    expect(d.difficulty).toBe('challenging')
    expect(d.minAge).toBe(12)
    expect(d.maxGroupSize).toBe(8)
    expect(d.languages).toEqual(['en', 'hi'])
    expect(d.meetingPoint).toBe('Shivpuri jetty')
    expect(d.seasonMonths).toEqual([9, 10, 11])
    expect(d.highlights).toEqual(['Grade III rapids', 'Riverside lunch'])
    expect(d.inclusions).toEqual(['Guide', 'Safety gear'])
    expect(d.exclusions).toEqual(['Transport'])
    expect(d.whatToBring).toEqual(['Towel', 'Sunscreen'])

    expect(d.itinerary.map((s) => s.title)).toEqual(['Briefing', 'Rapids'])
    expect(d.itinerary.map((s) => s.stepOrder)).toEqual([0, 1])
  })

  it('returns null scalars, empty arrays, and an empty itinerary for a bare Experience', async () => {
    await seedExperience({ slug: 'bare-rafting' })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'bare-rafting' })
    expect(result!.type).toBe('found')
    if (result!.type !== 'found') throw new Error('unreachable')
    const d = result!.data

    expect(d.durationMinutes).toBeNull()
    expect(d.difficulty).toBeNull()
    expect(d.minAge).toBeNull()
    expect(d.maxGroupSize).toBeNull()
    expect(d.meetingPoint).toBeNull()
    expect(d.languages).toEqual([])
    expect(d.seasonMonths).toEqual([])
    expect(d.highlights).toEqual([])
    expect(d.inclusions).toEqual([])
    expect(d.exclusions).toEqual([])
    expect(d.whatToBring).toEqual([])
    expect(d.itinerary).toEqual([])
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
