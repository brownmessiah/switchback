import { describe, expect, it } from 'vitest'

import { isActivitySlug, listActivities } from '@/lib/activities/registry'
import { isRegionSlug, listRegions } from '@/lib/regions/registry'

import {
  ACTIVITY_OPTIONS,
  CATEGORY_OPTIONS,
  REGION_OPTIONS,
  STATE_OPTIONS,
} from './facet-options'

/**
 * Regression guard (#67 review): a search facet whose slug is NOT a real
 * registry slug submits an `activitySlug`/`regionSlug` that can never match
 * an indexed Experience — a dead, non-functional facet (0 results + noindex),
 * which ADR-0013 / the issue forbids. Deriving the options from the
 * controlled-vocabulary registries keeps every facet slug valid; this test
 * fails the moment an option drifts out of its registry.
 */
describe('facet-options stay in sync with the controlled-vocabulary registries', () => {
  it('every ACTIVITY_OPTIONS slug exists in the activities registry', () => {
    for (const option of ACTIVITY_OPTIONS) {
      expect(
        isActivitySlug(option.slug),
        `activity facet slug "${option.slug}" is not a registry slug`,
      ).toBe(true)
    }
  })

  it('every REGION_OPTIONS slug exists in the regions registry', () => {
    for (const option of REGION_OPTIONS) {
      expect(
        isRegionSlug(option.slug),
        `region facet slug "${option.slug}" is not a registry slug`,
      ).toBe(true)
    }
  })

  it('exposes at least one activity and one region option', () => {
    expect(ACTIVITY_OPTIONS.length).toBeGreaterThan(0)
    expect(REGION_OPTIONS.length).toBeGreaterThan(0)
  })

  // Category + Destination=State facets (issue 04 follow-up).
  it('CATEGORY_OPTIONS covers every category the activities registry rolls up to', () => {
    const usedCategories = new Set(listActivities().map((a) => a.category))
    const offered = new Set(CATEGORY_OPTIONS.map((o) => o.slug))
    for (const cat of usedCategories) {
      expect(
        offered.has(cat),
        `category "${cat}" is used by an activity but not offered as a facet`,
      ).toBe(true)
    }
  })

  it('every STATE_OPTIONS name is a real state in the regions registry', () => {
    const registryStates = new Set(listRegions().map((r) => r.state))
    for (const option of STATE_OPTIONS) {
      expect(
        registryStates.has(option.name),
        `state facet "${option.name}" is not a registry state`,
      ).toBe(true)
    }
  })

  it('STATE_OPTIONS lists each distinct registry state exactly once', () => {
    const registryStates = new Set(listRegions().map((r) => r.state))
    expect(STATE_OPTIONS).toHaveLength(registryStates.size)
    expect(new Set(STATE_OPTIONS.map((o) => o.name)).size).toBe(STATE_OPTIONS.length)
  })
})
