import { describe, expect, it } from 'vitest'

import { organization, type OrganizationArgs } from './organization'

describe('Organization JSON-LD (ADR-0013)', () => {
  const base: OrganizationArgs = {
    url: 'https://switchback.com',
  }

  it('generates a valid Organization schema with the Switchback brand name', () => {
    const result = organization(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('Organization')
    expect(result.name).toBe('Switchback')
    expect(result.url).toBe('https://switchback.com')
  })

  it('includes a contactPoint with the real support email', () => {
    const result = organization({
      ...base,
      contactEmail: 'support@switchback.com',
    })
    expect(result.contactPoint).toEqual({
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@switchback.com',
    })
  })

  it('omits contactPoint when no email is provided', () => {
    const result = organization(base)
    expect(result.contactPoint).toBeUndefined()
  })

  it('includes the logo when a real logo URL is provided', () => {
    const result = organization({
      ...base,
      logo: 'https://switchback.com/favicon.ico',
    })
    expect(result.logo).toBe('https://switchback.com/favicon.ico')
  })

  it('omits logo when none is provided', () => {
    const result = organization(base)
    expect(result.logo).toBeUndefined()
  })

  it('includes sameAs only when real social links are provided', () => {
    const result = organization({
      ...base,
      sameAs: ['https://instagram.com/switchback', 'https://youtube.com/@switchback'],
    })
    expect(result.sameAs).toEqual([
      'https://instagram.com/switchback',
      'https://youtube.com/@switchback',
    ])
  })

  it('omits sameAs when no social links are provided (D0: never invent URLs)', () => {
    const result = organization(base)
    expect(result.sameAs).toBeUndefined()
  })

  it('omits sameAs when the social link list is empty', () => {
    const result = organization({ ...base, sameAs: [] })
    expect(result.sameAs).toBeUndefined()
  })

  it('includes an optional description when provided', () => {
    const result = organization({ ...base, description: 'Adventure marketplace' })
    expect(result.description).toBe('Adventure marketplace')
  })

  it('throws on empty url', () => {
    expect(() => organization({ url: '' })).toThrow()
  })
})
