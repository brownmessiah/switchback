import { describe, expect, it } from 'vitest'

import { serverActionAllowedOrigins } from './origins'

/**
 * Server Action allowed-origin derivation (ADR-0019). Behind the LB the prod
 * host must be trusted or Next's Origin/Host CSRF check rejects Server Actions.
 * Derived from NEXT_PUBLIC_APP_URL (+ optional comma-separated extras) at build.
 */
describe('serverActionAllowedOrigins', () => {
  it('derives the host from the app URL', () => {
    expect(serverActionAllowedOrigins('https://outvers.com')).toEqual(['outvers.com'])
  })

  it('keeps the port for a localhost URL', () => {
    expect(serverActionAllowedOrigins('http://localhost:3000')).toEqual(['localhost:3000'])
  })

  it('merges extra comma-separated origins (URLs or bare hosts), deduped', () => {
    expect(
      serverActionAllowedOrigins('https://outvers.com', 'https://www.outvers.com, staging.outvers.com, https://outvers.com'),
    ).toEqual(['outvers.com', 'www.outvers.com', 'staging.outvers.com'])
  })

  it('returns an empty list when nothing is configured', () => {
    expect(serverActionAllowedOrigins(undefined)).toEqual([])
    expect(serverActionAllowedOrigins('')).toEqual([])
  })
})
