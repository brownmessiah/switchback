/**
 * Tests for i18n translation management script logic.
 *
 * Tests pure functions extracted from the three scripts:
 *   - i18n-check: flattenKeys, findMissingKeys, findExtraKeys, findEmptyValues
 *   - i18n-missing-report: selectStrategy
 *   - i18n-merge: mergeTranslations, setNested
 */
import { describe, it, expect } from 'vitest'

import {
  flattenKeys,
  findMissingKeys,
  findExtraKeys,
  findEmptyValues,
  selectStrategy,
  mergeTranslations,
  setNested,
  type NestedMessages,
} from '@/scripts/i18n-utils'

// ─── flattenKeys ────────────────────────────────────────────────────────

describe('flattenKeys', () => {
  it('flattens a simple flat object', () => {
    const obj: NestedMessages = { title: 'Hello', subtitle: 'World' }
    const result = flattenKeys(obj)
    expect(result).toEqual(
      new Map([
        ['title', 'Hello'],
        ['subtitle', 'World'],
      ])
    )
  })

  it('flattens nested objects with dot-separated keys', () => {
    const obj: NestedMessages = {
      HomePage: {
        hero: {
          title: 'Book the scene',
          subtitle: 'Rafting in Rishikesh',
        },
      },
    }
    const result = flattenKeys(obj)
    expect(result).toEqual(
      new Map([
        ['HomePage.hero.title', 'Book the scene'],
        ['HomePage.hero.subtitle', 'Rafting in Rishikesh'],
      ])
    )
  })

  it('returns empty map for empty object', () => {
    expect(flattenKeys({})).toEqual(new Map())
  })

  it('handles deeply nested objects', () => {
    const obj: NestedMessages = { a: { b: { c: { d: 'deep' } } } }
    const result = flattenKeys(obj)
    expect(result).toEqual(new Map([['a.b.c.d', 'deep']]))
  })

  it('handles mixed nesting levels', () => {
    const obj: NestedMessages = {
      flat: 'value',
      nested: { key: 'value2' },
    }
    const result = flattenKeys(obj)
    expect(result.get('flat')).toBe('value')
    expect(result.get('nested.key')).toBe('value2')
  })
})

// ─── findMissingKeys ────────────────────────────────────────────────────

describe('findMissingKeys', () => {
  it('returns keys present in source but not in target', () => {
    const sourceKeys = new Set(['a', 'b', 'c'])
    const targetKeys = new Set(['a', 'c'])
    expect(findMissingKeys(sourceKeys, targetKeys)).toEqual(['b'])
  })

  it('returns empty array when all keys are present', () => {
    const keys = new Set(['a', 'b'])
    expect(findMissingKeys(keys, keys)).toEqual([])
  })

  it('returns all source keys when target is empty', () => {
    const sourceKeys = new Set(['a', 'b', 'c'])
    expect(findMissingKeys(sourceKeys, new Set())).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array when source is empty', () => {
    expect(findMissingKeys(new Set(), new Set(['a']))).toEqual([])
  })
})

// ─── findExtraKeys ──────────────────────────────────────────────────────

describe('findExtraKeys', () => {
  it('returns keys in target not in source', () => {
    const sourceKeys = new Set(['a', 'b'])
    const targetKeys = new Set(['a', 'b', 'c', 'd'])
    expect(findExtraKeys(sourceKeys, targetKeys)).toEqual(['c', 'd'])
  })

  it('returns empty array when no extra keys', () => {
    const keys = new Set(['a', 'b'])
    expect(findExtraKeys(keys, keys)).toEqual([])
  })

  it('returns empty array when target is empty', () => {
    expect(findExtraKeys(new Set(['a']), new Set())).toEqual([])
  })
})

// ─── findEmptyValues ────────────────────────────────────────────────────

describe('findEmptyValues', () => {
  it('finds keys with empty string values in flat map', () => {
    const entries = new Map([
      ['a', 'hello'],
      ['b', ''],
      ['c', 'world'],
      ['d', ''],
    ])
    expect(findEmptyValues(entries)).toEqual(['b', 'd'])
  })

  it('returns empty array when no empty values', () => {
    const entries = new Map([
      ['a', 'hello'],
      ['b', 'world'],
    ])
    expect(findEmptyValues(entries)).toEqual([])
  })

  it('returns empty array for empty map', () => {
    expect(findEmptyValues(new Map())).toEqual([])
  })
})

// ─── selectStrategy ─────────────────────────────────────────────────────

describe('selectStrategy', () => {
  it('returns single-call for small batch under thresholds', () => {
    // 50 keys, 5000 bytes estimated — both under thresholds
    expect(selectStrategy(50, 5000)).toBe('single-call')
  })

  it('returns per-locale-parallel when key count exceeds 100', () => {
    expect(selectStrategy(101, 5000)).toBe('per-locale-parallel')
  })

  it('returns per-locale-parallel when estimated bytes exceeds 15000', () => {
    expect(selectStrategy(50, 15001)).toBe('per-locale-parallel')
  })

  it('returns per-locale-parallel when both thresholds exceeded', () => {
    expect(selectStrategy(200, 20000)).toBe('per-locale-parallel')
  })

  it('returns single-call at exact thresholds (100 keys, 15000 bytes)', () => {
    expect(selectStrategy(100, 15000)).toBe('single-call')
  })

  it('returns per-locale-parallel at 101 keys even with 0 bytes', () => {
    expect(selectStrategy(101, 0)).toBe('per-locale-parallel')
  })

  it('returns single-call for zero keys and zero bytes', () => {
    expect(selectStrategy(0, 0)).toBe('single-call')
  })
})

// ─── setNested ──────────────────────────────────────────────────────────

describe('setNested', () => {
  it('sets a top-level key', () => {
    const obj: NestedMessages = {}
    setNested(obj, 'title', 'Hello')
    expect(obj).toEqual({ title: 'Hello' })
  })

  it('sets a deeply nested key, creating intermediates', () => {
    const obj: NestedMessages = {}
    setNested(obj, 'HomePage.hero.title', 'Booked')
    expect(obj).toEqual({ HomePage: { hero: { title: 'Booked' } } })
  })

  it('preserves existing sibling keys', () => {
    const obj: NestedMessages = {
      HomePage: { hero: { title: 'Old' } },
    }
    setNested(obj, 'HomePage.hero.subtitle', 'New')
    expect(obj).toEqual({
      HomePage: { hero: { title: 'Old', subtitle: 'New' } },
    })
  })

  it('overwrites a string value', () => {
    const obj: NestedMessages = { title: 'Old' }
    setNested(obj, 'title', 'New')
    expect(obj).toEqual({ title: 'New' })
  })

  it('throws when intermediate is a string', () => {
    const obj: NestedMessages = { HomePage: 'a string' }
    expect(() => setNested(obj, 'HomePage.hero.title', 'value')).toThrow(
      'intermediate'
    )
  })
})

// ─── mergeTranslations ──────────────────────────────────────────────────

describe('mergeTranslations', () => {
  const enKeys = new Set([
    'HomePage.hero.title',
    'HomePage.hero.subtitle',
    'Common.notFound',
  ])

  it('merges missing keys into existing locale object', () => {
    const existing: NestedMessages = {
      HomePage: { hero: { title: 'existing title' } },
    }
    const incoming: Record<string, string> = {
      'HomePage.hero.subtitle': 'new subtitle',
      'Common.notFound': 'not found',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.merged).toEqual({
        HomePage: { hero: { title: 'existing title', subtitle: 'new subtitle' } },
        Common: { notFound: 'not found' },
      })
    }
  })

  it('rejects keys not in en.json', () => {
    const existing: NestedMessages = {}
    const incoming: Record<string, string> = {
      'Unknown.key': 'value',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unknownKeys).toContain('Unknown.key')
    }
  })

  it('rejects empty string values', () => {
    const existing: NestedMessages = {}
    const incoming: Record<string, string> = {
      'HomePage.hero.title': '',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.emptyValues).toContain('HomePage.hero.title')
    }
  })

  it('refuses to overwrite existing non-empty translations', () => {
    const existing: NestedMessages = {
      HomePage: { hero: { title: 'already translated' } },
    }
    const incoming: Record<string, string> = {
      'HomePage.hero.title': 'different translation',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts![0]).toEqual({
        key: 'HomePage.hero.title',
        existing: 'already translated',
        incoming: 'different translation',
      })
    }
  })

  it('allows overwriting empty string values', () => {
    const existing: NestedMessages = {
      HomePage: { hero: { title: '' } },
    }
    const incoming: Record<string, string> = {
      'HomePage.hero.title': 'new translation',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.merged.HomePage).toEqual({ hero: { title: 'new translation' } })
    }
  })

  it('is idempotent — merging same value is a no-op', () => {
    const existing: NestedMessages = {
      HomePage: { hero: { title: 'same value' } },
    }
    const incoming: Record<string, string> = {
      'HomePage.hero.title': 'same value',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    // Same value = not a conflict
    expect(result.ok).toBe(true)
  })

  it('reports multiple errors at once', () => {
    const existing: NestedMessages = {
      HomePage: { hero: { title: 'exists' } },
    }
    const incoming: Record<string, string> = {
      'HomePage.hero.title': 'overwrite attempt',
      'Unknown.key': 'bad key',
      'Common.notFound': '',
    }
    const result = mergeTranslations(existing, incoming, enKeys)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unknownKeys!.length).toBeGreaterThan(0)
      expect(result.emptyValues!.length).toBeGreaterThan(0)
      expect(result.conflicts!.length).toBeGreaterThan(0)
    }
  })
})
