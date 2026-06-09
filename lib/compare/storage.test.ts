import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMPARE_MAX,
  COMPARE_STORAGE_KEY,
  addToCompare,
  clearCompare,
  getCompareSlugs,
  isInCompare,
  removeFromCompare,
  toggleCompare,
} from './storage'

/**
 * In-memory `Storage`-shaped stub. The compare-selection core takes a
 * `StorageLike` so the cap (max 3) / dedupe / persistence / malformed-resilience
 * rules are exercised without jsdom's localStorage, and so the SSR no-op path is
 * a plain `undefined` argument. Only the three methods the core uses exist.
 */
function makeStorage(initial?: string): {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
  raw: () => string | null
} {
  let value: string | null = initial ?? null
  return {
    getItem: (k: string) => (k === COMPARE_STORAGE_KEY ? value : null),
    setItem: (k: string, v: string) => {
      if (k === COMPARE_STORAGE_KEY) value = v
    },
    removeItem: (k: string) => {
      if (k === COMPARE_STORAGE_KEY) value = null
    },
    raw: () => value,
  }
}

describe('addToCompare + getCompareSlugs', () => {
  it('adds a slug and reads it back', () => {
    const store = makeStorage()
    addToCompare('rafting-rishikesh', store)
    expect(getCompareSlugs(store)).toEqual(['rafting-rishikesh'])
  })

  it('preserves insertion order (oldest-first, the order columns render in)', () => {
    const store = makeStorage()
    addToCompare('a', store)
    addToCompare('b', store)
    addToCompare('c', store)
    expect(getCompareSlugs(store)).toEqual(['a', 'b', 'c'])
  })

  it('dedupes — adding an already-selected slug is a no-op (no second entry)', () => {
    const store = makeStorage()
    addToCompare('a', store)
    addToCompare('b', store)
    addToCompare('a', store)
    expect(getCompareSlugs(store)).toEqual(['a', 'b'])
  })

  it('caps the selection at COMPARE_MAX — a 4th distinct slug is rejected', () => {
    const store = makeStorage()
    addToCompare('a', store)
    addToCompare('b', store)
    addToCompare('c', store)
    addToCompare('d', store)
    const slugs = getCompareSlugs(store)
    expect(slugs).toHaveLength(COMPARE_MAX)
    expect(slugs).toEqual(['a', 'b', 'c'])
    expect(slugs).not.toContain('d')
  })

  it('COMPARE_MAX is 3 (the D10 cap)', () => {
    expect(COMPARE_MAX).toBe(3)
  })

  it('ignores empty / whitespace slugs (no-op)', () => {
    const store = makeStorage()
    addToCompare('', store)
    addToCompare('   ', store)
    expect(getCompareSlugs(store)).toEqual([])
  })
})

describe('removeFromCompare', () => {
  it('removes a selected slug, keeping the rest in order', () => {
    const store = makeStorage()
    addToCompare('a', store)
    addToCompare('b', store)
    addToCompare('c', store)
    removeFromCompare('b', store)
    expect(getCompareSlugs(store)).toEqual(['a', 'c'])
  })

  it('is a no-op when the slug is not selected', () => {
    const store = makeStorage()
    addToCompare('a', store)
    removeFromCompare('zzz', store)
    expect(getCompareSlugs(store)).toEqual(['a'])
  })
})

describe('toggleCompare', () => {
  it('adds a slug that is not yet selected', () => {
    const store = makeStorage()
    toggleCompare('a', store)
    expect(getCompareSlugs(store)).toEqual(['a'])
  })

  it('removes a slug that is already selected', () => {
    const store = makeStorage()
    addToCompare('a', store)
    toggleCompare('a', store)
    expect(getCompareSlugs(store)).toEqual([])
  })

  it('does not add past the cap (toggling a 4th slug on is a no-op)', () => {
    const store = makeStorage()
    addToCompare('a', store)
    addToCompare('b', store)
    addToCompare('c', store)
    toggleCompare('d', store)
    expect(getCompareSlugs(store)).toEqual(['a', 'b', 'c'])
  })
})

describe('isInCompare', () => {
  it('reports membership', () => {
    const store = makeStorage()
    addToCompare('a', store)
    expect(isInCompare('a', store)).toBe(true)
    expect(isInCompare('b', store)).toBe(false)
  })
})

describe('clearCompare', () => {
  it('empties the selection', () => {
    const store = makeStorage()
    addToCompare('a', store)
    addToCompare('b', store)
    clearCompare(store)
    expect(getCompareSlugs(store)).toEqual([])
  })
})

describe('malformed-storage resilience', () => {
  it('returns [] when the stored value is not valid JSON', () => {
    const store = makeStorage('{not json')
    expect(getCompareSlugs(store)).toEqual([])
  })

  it('returns [] when the stored JSON is not an array', () => {
    const store = makeStorage(JSON.stringify({ slugs: ['a'] }))
    expect(getCompareSlugs(store)).toEqual([])
  })

  it('filters out non-string / empty entries inside a stored array', () => {
    const store = makeStorage(JSON.stringify(['a', 1, null, '', '  ', 'b']))
    expect(getCompareSlugs(store)).toEqual(['a', 'b'])
  })

  it('caps a corrupt over-long stored array to COMPARE_MAX on read', () => {
    const store = makeStorage(JSON.stringify(['a', 'b', 'c', 'd', 'e']))
    expect(getCompareSlugs(store)).toEqual(['a', 'b', 'c'])
  })

  it('recovers (overwrites) when adding onto a corrupt store', () => {
    const store = makeStorage('garbage')
    addToCompare('a', store)
    expect(getCompareSlugs(store)).toEqual(['a'])
  })
})

describe('SSR / unavailable-storage safety', () => {
  it('getCompareSlugs returns [] when no storage is provided (SSR)', () => {
    expect(getCompareSlugs(undefined)).toEqual([])
  })

  it('mutators are no-ops when no storage is provided (SSR)', () => {
    expect(() => addToCompare('a', undefined)).not.toThrow()
    expect(() => removeFromCompare('a', undefined)).not.toThrow()
    expect(() => toggleCompare('a', undefined)).not.toThrow()
    expect(() => clearCompare(undefined)).not.toThrow()
  })

  it('swallows storage exceptions (quota / private mode) without throwing', () => {
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
    expect(() => addToCompare('a', throwing)).not.toThrow()
    expect(getCompareSlugs(throwing)).toEqual([])
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
    addToCompare('a')
    addToCompare('b')
    expect(getCompareSlugs()).toEqual(['a', 'b'])
  })
})
