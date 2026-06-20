import { describe, expect, it } from 'vitest'

import {
  LISTING_COMPLETENESS_FIELDS,
  computeListingCompleteness,
  type ListingCompletenessInput,
} from './listing-completeness'

/**
 * A fully-filled Experience: every required field present, ≥1 image.
 * Mirrors the real `experiences` columns the vendor editor writes.
 */
const FULL: ListingCompletenessInput = {
  title: 'Grade III White-Water Rafting, Rishikesh',
  shortDescription: 'A thrilling stretch of the Ganga.',
  longDescription: 'Full-day guided rafting with certified guides and gear.',
  pricePerPerson_1_2: '2500.00',
  pricePerPerson_3_5: '2200.00',
  pricePerPerson_6_plus: '2000.00',
  activitySlug: 'rafting',
  regionSlug: 'rishikesh',
  imageCount: 3,
}

describe('computeListingCompleteness', () => {
  it('scores a fully-filled experience at 100%', () => {
    const result = computeListingCompleteness(FULL)
    expect(result.percent).toBe(100)
    expect(result.filled).toBe(result.total)
    expect(result.total).toBe(LISTING_COMPLETENESS_FIELDS.length)
    expect(result.missing).toEqual([])
  })

  it('scores a draft missing description + brackets lower than full', () => {
    const draft: ListingCompletenessInput = {
      ...FULL,
      shortDescription: null,
      longDescription: null,
      // brackets default to the headline only — the 3-5 / 6+ tiers unfilled.
      pricePerPerson_3_5: null,
      pricePerPerson_6_plus: null,
    }
    const result = computeListingCompleteness(draft)

    // 4 of the 9 required fields are missing → 5/9 filled.
    expect(result.percent).toBeLessThan(100)
    expect(result.filled).toBe(5)
    expect(result.total).toBe(9)
    expect(result.percent).toBe(56) // round(5/9 * 100)
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'shortDescription',
        'longDescription',
        'pricePerPerson_3_5',
        'pricePerPerson_6_plus',
      ]),
    )
  })

  it('scores an empty experience low (only the notNull title-ish fields)', () => {
    const empty: ListingCompletenessInput = {
      title: '',
      shortDescription: null,
      longDescription: null,
      pricePerPerson_1_2: null,
      pricePerPerson_3_5: null,
      pricePerPerson_6_plus: null,
      activitySlug: '',
      regionSlug: '',
      imageCount: 0,
    }
    const result = computeListingCompleteness(empty)
    expect(result.percent).toBe(0)
    expect(result.filled).toBe(0)
  })

  it('does not count a zero or blank price bracket as filled (no fabrication)', () => {
    const result = computeListingCompleteness({
      ...FULL,
      pricePerPerson_1_2: '0',
      pricePerPerson_3_5: '0.00',
      pricePerPerson_6_plus: null,
    })
    // 3 price brackets drop out → 6/9 filled.
    expect(result.filled).toBe(6)
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'pricePerPerson_1_2',
        'pricePerPerson_3_5',
        'pricePerPerson_6_plus',
      ]),
    )
  })

  it('counts at least one image as the media field; zero images is unfilled', () => {
    const noImages = computeListingCompleteness({ ...FULL, imageCount: 0 })
    expect(noImages.missing).toContain('imageCount')
    expect(noImages.filled).toBe(LISTING_COMPLETENESS_FIELDS.length - 1)

    const withImages = computeListingCompleteness({ ...FULL, imageCount: 1 })
    expect(withImages.missing).not.toContain('imageCount')
  })

  it('treats whitespace-only text as unfilled', () => {
    const result = computeListingCompleteness({
      ...FULL,
      shortDescription: '   ',
      longDescription: '\n\t',
    })
    expect(result.missing).toEqual(
      expect.arrayContaining(['shortDescription', 'longDescription']),
    )
  })

  it('counts a positive NUMBER price (not just string) as filled', () => {
    // Drizzle numeric columns usually arrive as strings, but the input type
    // also permits raw numbers — exercise the number branch of hasPositivePrice.
    const result = computeListingCompleteness({
      ...FULL,
      pricePerPerson_1_2: 2500,
      pricePerPerson_3_5: 2200,
      pricePerPerson_6_plus: 2000,
    })
    expect(result.percent).toBe(100)
    expect(result.missing).not.toContain('pricePerPerson_1_2')
  })

  it('does not count a zero or negative NUMBER price as filled', () => {
    const result = computeListingCompleteness({
      ...FULL,
      pricePerPerson_1_2: 0,
      pricePerPerson_3_5: -1,
      pricePerPerson_6_plus: 2000,
    })
    // The 0 and -1 numeric brackets drop out; only the 6+ bracket remains.
    expect(result.missing).toEqual(
      expect.arrayContaining(['pricePerPerson_1_2', 'pricePerPerson_3_5']),
    )
    expect(result.missing).not.toContain('pricePerPerson_6_plus')
  })
})
