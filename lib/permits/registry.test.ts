import { describe, expect, it } from 'vitest'

import {
  getPermit,
  isPermitSlug,
  listPermits,
  resolvePermits,
} from './registry'

/**
 * Permit registry per ADR-0011 (Required permits).
 *
 * `experiences.required_permits[]` holds controlled permit slugs. The
 * registry is the single catalogue that resolves a slug to the metadata
 * the Booking Permits panel surfaces: name, issuing authority, official
 * URL, processing time, indicative cost, validity, and a short
 * description. Outvers does NOT broker permits in v1 — the panel is
 * informational + a mandatory acknowledgement at checkout.
 */
describe('permits registry (ADR-0011)', () => {
  it('lists every permit exactly once with a well-formed slug + required fields', () => {
    const permits = listPermits()
    expect(permits.length).toBeGreaterThan(0)

    const slugs = permits.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    for (const permit of permits) {
      expect(permit.slug).toMatch(/^[a-z0-9_]+$/)
      expect(permit.name).toBeTruthy()
      expect(permit.authority).toBeTruthy()
      expect(permit.officialUrl).toMatch(/^https?:\/\//)
      expect(permit.processingTime).toBeTruthy()
      expect(permit.indicativeCost).toBeTruthy()
      expect(permit.validity).toBeTruthy()
      expect(permit.description).toBeTruthy()
    }
  })

  it('returns canonical permit metadata by slug', () => {
    const permit = getPermit('ilp_sikkim')
    expect(permit).toBeDefined()
    expect(permit?.slug).toBe('ilp_sikkim')
    // The metadata is real, not a placeholder — assert the authority is the
    // Sikkim state government, the entity that actually issues the ILP.
    expect(permit?.authority).toMatch(/Sikkim/i)
    expect(permit?.officialUrl).toMatch(/^https?:\/\//)
  })

  it('returns undefined for an unknown permit slug', () => {
    expect(getPermit('atlantis_pass')).toBeUndefined()
  })

  it('isPermitSlug narrows the type for known slugs', () => {
    expect(isPermitSlug('ilp_sikkim')).toBe(true)
    expect(isPermitSlug('atlantis_pass')).toBe(false)
    expect(isPermitSlug('')).toBe(false)
    expect(isPermitSlug(42)).toBe(false)
  })

  it('catalogues the permit slugs already referenced by Experiences', () => {
    // These slugs appear in seeded Experiences + existing tests; the
    // catalogue must resolve all of them so the Permits panel never shows
    // a bare slug to a Customer.
    for (const slug of [
      'ilp_sikkim',
      'ilp_arunachal_pradesh',
      'forest_entry',
      'wildlife_corbett',
    ]) {
      expect(getPermit(slug), `missing catalogue entry: ${slug}`).toBeDefined()
    }
  })

  describe('resolvePermits — Experience.required_permits[] → panel metadata', () => {
    it('maps every known slug to its full metadata in input order', () => {
      const resolved = resolvePermits(['ilp_sikkim', 'forest_entry'])
      expect(resolved.resolved.map((p) => p.slug)).toEqual([
        'ilp_sikkim',
        'forest_entry',
      ])
      expect(resolved.resolved[0]?.name).toBe(getPermit('ilp_sikkim')!.name)
      expect(resolved.resolved[1]?.authority).toBe(
        getPermit('forest_entry')!.authority,
      )
      expect(resolved.unknown).toEqual([])
    })

    it('returns an empty result for an Experience with no required permits', () => {
      const resolved = resolvePermits([])
      expect(resolved.resolved).toEqual([])
      expect(resolved.unknown).toEqual([])
    })

    it('surfaces unknown slugs separately instead of dropping them silently', () => {
      const resolved = resolvePermits(['ilp_sikkim', 'mystery_permit'])
      expect(resolved.resolved.map((p) => p.slug)).toEqual(['ilp_sikkim'])
      expect(resolved.unknown).toEqual(['mystery_permit'])
    })
  })
})
