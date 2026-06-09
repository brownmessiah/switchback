import { describe, expect, it } from 'vitest'

import { buildMapsDeepLink } from './deep-link'

/**
 * Issue 11 — "Open in Maps" deep-link builder.
 *
 * Accepts EITHER coords OR a free-text query (issue 15's meeting point is
 * free-text + a region). Builds a Google Maps universal URL. Pure + URL-encoded.
 */
describe('buildMapsDeepLink', () => {
  it('builds a coords link in the Google Maps universal format', () => {
    const href = buildMapsDeepLink({ lat: 30.0869, lng: 78.2676 })
    expect(href).toBe(
      'https://www.google.com/maps/search/?api=1&query=30.0869%2C78.2676',
    )
  })

  it('builds a query link, URL-encoding the free text', () => {
    const href = buildMapsDeepLink({
      query: 'Lakshman Jhula, Rishikesh',
    })
    expect(href).toBe(
      'https://www.google.com/maps/search/?api=1&query=Lakshman+Jhula%2C+Rishikesh',
    )
  })

  it('prefers coords over query when both are supplied', () => {
    const href = buildMapsDeepLink({
      lat: 15.2993,
      lng: 74.124,
      query: 'somewhere else',
    })
    expect(href).toContain('query=15.2993%2C74.124')
    expect(href).not.toContain('somewhere')
  })

  it('returns null when neither coords nor a non-empty query are supplied', () => {
    expect(buildMapsDeepLink({})).toBeNull()
    expect(buildMapsDeepLink({ query: '   ' })).toBeNull()
  })

  it('produces a valid, parseable absolute URL', () => {
    const href = buildMapsDeepLink({ query: 'Bir Billing takeoff' })
    expect(href).not.toBeNull()
    const url = new URL(href!)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('www.google.com')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('query')).toBe('Bir Billing takeoff')
  })

  it('round-trips coords through URL parsing', () => {
    const href = buildMapsDeepLink({ lat: 32.0419, lng: 76.7305 })
    const url = new URL(href!)
    expect(url.searchParams.get('query')).toBe('32.0419,76.7305')
  })
})
