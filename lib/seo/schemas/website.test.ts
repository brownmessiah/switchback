import { describe, expect, it } from 'vitest'

import { website, type WebSiteArgs } from './website'

describe('WebSite JSON-LD (ADR-0013)', () => {
  const base: WebSiteArgs = {
    url: 'https://outvers.com',
    searchUrlTemplate: 'https://outvers.com/search?q={search_term_string}',
  }

  it('generates a valid WebSite schema with the Outvers brand name', () => {
    const result = website(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('WebSite')
    expect(result.name).toBe('Outvers')
    expect(result.url).toBe('https://outvers.com')
  })

  it('emits a SearchAction potentialAction targeting the search URL template', () => {
    const result = website(base)
    expect(result.potentialAction['@type']).toBe('SearchAction')
    expect(result.potentialAction.target).toBe(
      'https://outvers.com/search?q={search_term_string}',
    )
    expect(result.potentialAction['query-input']).toBe(
      'required name=search_term_string',
    )
  })

  it('requires the {search_term_string} placeholder in the target template', () => {
    expect(() =>
      website({ ...base, searchUrlTemplate: 'https://outvers.com/search' }),
    ).toThrow(/search_term_string/)
  })

  it('throws on empty url', () => {
    expect(() => website({ ...base, url: '' })).toThrow()
  })
})
