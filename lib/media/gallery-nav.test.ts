import { describe, expect, it } from 'vitest'

import { nextIndex, prevIndex } from './gallery-nav'

/**
 * Issue 14 — pure current-index navigation for the PDP fullscreen gallery.
 *
 * The modal advances/retreats through a fixed-length image list. Navigation
 * WRAPS (a circular gallery): from the last image, "next" returns to the first;
 * from the first, "previous" returns to the last. This keeps on-screen prev/next
 * buttons and ArrowRight/ArrowLeft always actionable without dead-ends.
 */

describe('gallery-nav — nextIndex (wrap)', () => {
  it('advances to the following index', () => {
    expect(nextIndex(0, 5)).toBe(1)
    expect(nextIndex(3, 5)).toBe(4)
  })

  it('wraps from the last index back to the first', () => {
    expect(nextIndex(4, 5)).toBe(0)
  })

  it('is a no-op stable index for a single-image gallery', () => {
    expect(nextIndex(0, 1)).toBe(0)
  })

  it('clamps an empty gallery to 0 (defensive)', () => {
    expect(nextIndex(0, 0)).toBe(0)
  })
})

describe('gallery-nav — prevIndex (wrap)', () => {
  it('retreats to the preceding index', () => {
    expect(prevIndex(4, 5)).toBe(3)
    expect(prevIndex(1, 5)).toBe(0)
  })

  it('wraps from the first index back to the last', () => {
    expect(prevIndex(0, 5)).toBe(4)
  })

  it('is a no-op stable index for a single-image gallery', () => {
    expect(prevIndex(0, 1)).toBe(0)
  })

  it('clamps an empty gallery to 0 (defensive)', () => {
    expect(prevIndex(0, 0)).toBe(0)
  })
})
