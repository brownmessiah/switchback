import { describe, expect, it } from 'vitest'

import {
  getActivity,
  isActivitySlug,
  listActivities,
} from './registry'

describe('activities registry', () => {
  it('lists every activity exactly once with stable slug + display names', () => {
    const activities = listActivities()
    const slugs = activities.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const activity of activities) {
      expect(activity.slug).toMatch(/^[a-z0-9-]+$/)
      expect(activity.displayName.en).toBeTruthy()
    }
  })

  it('returns canonical activity metadata by slug', () => {
    const a = getActivity('rafting')
    expect(a).toBeDefined()
    expect(a?.displayName.en).toBe('Rafting')
  })

  it('returns undefined for unknown slugs', () => {
    expect(getActivity('chess-boxing')).toBeUndefined()
  })

  it('isActivitySlug narrows the type for known slugs', () => {
    expect(isActivitySlug('rafting')).toBe(true)
    expect(isActivitySlug('chess-boxing')).toBe(false)
  })

  it('includes the highest-volume launch activities from ADR-0013', () => {
    const slugs = new Set(listActivities().map((a) => a.slug))
    expect(slugs.has('rafting')).toBe(true)
    expect(slugs.has('paragliding')).toBe(true)
    expect(slugs.has('scuba-diving')).toBe(true)
    expect(slugs.has('trekking')).toBe(true)
  })
})
