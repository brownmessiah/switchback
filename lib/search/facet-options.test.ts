import { describe, expect, it } from 'vitest'

import { isActivitySlug } from '@/lib/activities/registry'
import { isRegionSlug } from '@/lib/regions/registry'

import { ACTIVITY_OPTIONS, REGION_OPTIONS } from './facet-options'

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
})
