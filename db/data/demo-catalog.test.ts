/**
 * Dataset-constraints for the dev-only demo catalog (issue 06 — bounded pilot).
 *
 * Pure, no DB. Asserts the transcribed dataset (db/data/demo-catalog.ts) holds
 * the structural invariants the bounded pilot promises: 30 listings across 12
 * vendors, region-prefixed unique slugs, controlled-vocab region/activity, a
 * descending price ladder, every structured field within the ADR-0017 bounds
 * (validated against the shared Zod schemas), and referential integrity from
 * every listing back to a declared vendor.
 */
import { describe, expect, it } from 'vitest'

import { listActivities } from '@/lib/activities/registry'
import { listRegions } from '@/lib/regions/registry'
import {
  itinerarySchema,
  structuredExperienceSchema,
} from '@/lib/experiences/structured-schema'

import { DEMO_LISTINGS, DEMO_VENDORS } from './demo-catalog'

const REGION_SLUGS = new Set(listRegions().map((r) => r.slug))
const ACTIVITY_SLUGS = new Set(listActivities().map((a) => a.slug))

describe('demo catalog dataset constraints', () => {
  it('has exactly 30 listings and 12 vendors', () => {
    expect(DEMO_LISTINGS).toHaveLength(30)
    expect(DEMO_VENDORS).toHaveLength(12)
  })

  it('has unique vendor userIds and slugs', () => {
    const ids = DEMO_VENDORS.map((v) => v.userId)
    const slugs = DEMO_VENDORS.map((v) => v.slug)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has unique, region-prefixed listing slugs that never start with combo-', () => {
    const slugs = DEMO_LISTINGS.map((l) => l.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const l of DEMO_LISTINGS) {
      expect(l.slug.startsWith(`${l.region}-`)).toBe(true)
      expect(l.slug.startsWith('combo-')).toBe(false)
    }
  })

  it('covers every controlled-vocab region with at least 3 listings', () => {
    const byRegion = new Map<string, number>()
    for (const l of DEMO_LISTINGS) {
      byRegion.set(l.region, (byRegion.get(l.region) ?? 0) + 1)
    }
    // All 10 controlled-vocab regions are represented.
    expect(byRegion.size).toBe(REGION_SLUGS.size)
    for (const region of REGION_SLUGS) {
      expect(byRegion.get(region) ?? 0).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses only controlled-vocab region and activity slugs', () => {
    for (const l of DEMO_LISTINGS) {
      expect(REGION_SLUGS.has(l.region)).toBe(true)
      expect(ACTIVITY_SLUGS.has(l.activity)).toBe(true)
    }
  })

  it('has a non-increasing price ladder p12 >= p35 >= p6 (numeric)', () => {
    for (const l of DEMO_LISTINGS) {
      const p12 = Number(l.p12)
      const p35 = Number(l.p35)
      const p6 = Number(l.p6)
      expect(Number.isFinite(p12)).toBe(true)
      expect(Number.isFinite(p35)).toBe(true)
      expect(Number.isFinite(p6)).toBe(true)
      expect(p12).toBeGreaterThanOrEqual(p35)
      expect(p35).toBeGreaterThanOrEqual(p6)
    }
  })

  it('validates every listing against the ADR-0017 structured + itinerary schemas', () => {
    for (const l of DEMO_LISTINGS) {
      const structured = structuredExperienceSchema.safeParse({
        durationMinutes: l.durationMinutes,
        difficulty: l.difficulty,
        minAge: l.minAge,
        maxGroupSize: l.maxGroupSize,
        languages: l.languages,
        meetingPoint: l.meetingPoint,
        seasonMonths: l.seasonMonths,
        highlights: l.highlights,
        inclusions: l.inclusions,
        exclusions: l.exclusions,
        whatToBring: l.whatToBring,
      })
      expect(structured.success, `${l.slug} failed structuredExperienceSchema`).toBe(true)

      const itinerary = itinerarySchema.safeParse(l.itinerary)
      expect(itinerary.success, `${l.slug} failed itinerarySchema`).toBe(true)
    }
  })

  it('has all required structured fields present and non-empty on every listing', () => {
    for (const l of DEMO_LISTINGS) {
      expect(l.durationMinutes).toBeGreaterThan(0)
      expect(l.minAge).toBeGreaterThanOrEqual(0)
      expect(l.maxGroupSize).toBeGreaterThan(0)
      expect(l.languages.length).toBeGreaterThan(0)
      expect(l.meetingPoint.length).toBeGreaterThan(0)
      expect(l.seasonMonths.length).toBeGreaterThan(0)
      expect(l.highlights.length).toBeGreaterThan(0)
      expect(l.inclusions.length).toBeGreaterThan(0)
      expect(l.exclusions.length).toBeGreaterThan(0)
      expect(l.whatToBring.length).toBeGreaterThan(0)
      expect(l.itinerary.length).toBeGreaterThan(0)
    }
  })

  it('resolves every listing vendorId to a declared DEMO_VENDOR', () => {
    const vendorIds = new Set(DEMO_VENDORS.map((v) => v.userId))
    for (const l of DEMO_LISTINGS) {
      expect(vendorIds.has(l.vendorId), `${l.slug} -> ${l.vendorId} not a DEMO_VENDOR`).toBe(true)
    }
  })
})
