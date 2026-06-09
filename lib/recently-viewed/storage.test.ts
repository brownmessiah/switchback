import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RECENTLY_VIEWED_CAP,
  RECENTLY_VIEWED_STORAGE_KEY,
  getRecentSlugs,
  recordRecentlyViewed,
} from './storage'

/**
 * In-memory `Storage`-shaped stub. The recently-viewed core takes a
 * `StorageLike` so the cap / dedupe / recency / malformed-resilience rules can
 * be exercised without jsdom's localStorage (and so the SSR no-op path is a
 * plain `undefined` argument). Only the three methods the core uses are
 * implemented.
 */
function makeStorage(initial?: string): {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
  raw: () => string | null
} {
  let value: string | null = initial ?? null
  return {
    getItem: (k: string) => (k === RECENTLY_VIEWED_STORAGE_KEY ? value : null),
    setItem: (k: string, v: string) => {
      if (k === RECENTLY_VIEWED_STORAGE_KEY) value = v
    },
    removeItem: (k: string) => {
      if (k === RECENTLY_VIEWED_STORAGE_KEY) value = null
    },
    raw: () => value,
  }
}

describe('recordRecentlyViewed + getRecentSlugs', () => {
  it('records a slug and reads it back', () => {
    const store = makeStorage()
    recordRecentlyViewed('rafting-rishikesh', store)
    expect(getRecentSlugs(store)).toEqual(['rafting-rishikesh'])
  })

  it('orders most-recent-first (latest recorded comes first)', () => {
    const store = makeStorage()
    recordRecentlyViewed('a', store)
    recordRecentlyViewed('b', store)
    recordRecentlyViewed('c', store)
    expect(getRecentSlugs(store)).toEqual(['c', 'b', 'a'])
  })

  it('dedupes — re-viewing a slug moves it to the front without duplicating', () => {
    const store = makeStorage()
    recordRecentlyViewed('a', store)
    recordRecentlyViewed('b', store)
    recordRecentlyViewed('a', store)
    expect(getRecentSlugs(store)).toEqual(['a', 'b'])
  })

  it('caps the list at RECENTLY_VIEWED_CAP, dropping the oldest', () => {
    const store = makeStorage()
    // Record CAP + 3 distinct slugs; only the newest CAP survive.
    const total = RECENTLY_VIEWED_CAP + 3
    for (let i = 0; i < total; i++) {
      recordRecentlyViewed(`slug-${i}`, store)
    }
    const recent = getRecentSlugs(store)
    expect(recent).toHaveLength(RECENTLY_VIEWED_CAP)
    // Newest is the last recorded; oldest three (slug-0..slug-2) are gone.
    expect(recent[0]).toBe(`slug-${total - 1}`)
    expect(recent).not.toContain('slug-0')
    expect(recent).not.toContain('slug-2')
    expect(recent).toContain('slug-3')
  })

  it('ignores empty / whitespace slugs (no-op)', () => {
    const store = makeStorage()
    recordRecentlyViewed('', store)
    recordRecentlyViewed('   ', store)
    expect(getRecentSlugs(store)).toEqual([])
  })

  it('returns [] for an empty store', () => {
    const store = makeStorage()
    expect(getRecentSlugs(store)).toEqual([])
  })
})

describe('malformed-storage resilience', () => {
  it('returns [] when the stored value is not valid JSON', () => {
    const store = makeStorage('{not json')
    expect(getRecentSlugs(store)).toEqual([])
  })

  it('returns [] when the stored JSON is not an array', () => {
    const store = makeStorage(JSON.stringify({ slugs: ['a'] }))
    expect(getRecentSlugs(store)).toEqual([])
  })

  it('filters out non-string / empty entries inside a stored array', () => {
    const store = makeStorage(JSON.stringify(['a', 1, null, '', '  ', 'b']))
    expect(getRecentSlugs(store)).toEqual(['a', 'b'])
  })

  it('recovers (overwrites) when recording onto a corrupt store', () => {
    const store = makeStorage('garbage')
    recordRecentlyViewed('a', store)
    expect(getRecentSlugs(store)).toEqual(['a'])
  })
})

describe('SSR / unavailable-storage safety', () => {
  it('getRecentSlugs returns [] when no storage is provided (SSR)', () => {
    expect(getRecentSlugs(undefined)).toEqual([])
  })

  it('recordRecentlyViewed is a no-op when no storage is provided (SSR)', () => {
    // Must not throw.
    expect(() => recordRecentlyViewed('a', undefined)).not.toThrow()
  })

  it('swallows storage exceptions (e.g. quota / private mode) without throwing', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => recordRecentlyViewed('a', throwing)).not.toThrow()
    expect(getRecentSlugs(throwing)).toEqual([])
  })
})

describe('default (window.localStorage) binding', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('defaults to window.localStorage when no storage argument is passed', () => {
    recordRecentlyViewed('a')
    recordRecentlyViewed('b')
    expect(getRecentSlugs()).toEqual(['b', 'a'])
  })
})
