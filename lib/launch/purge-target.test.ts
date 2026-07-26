import { describe, expect, it } from 'vitest'

import { assertPurgeTarget, describeTarget, PRODUCTION_DB_NAME } from './purge-target'

/**
 * Production-target assertion (launch-readiness 05).
 *
 * `outvers` is a strict PREFIX of both `outvers_dev` and `outvers_e2e`,
 * so any `includes` / `startsWith` check passes for all three — the exact
 * shape of mistake that destroys a developer's local database or the E2E
 * database mid-suite. Only exact database-name equality is safe.
 *
 * NODE_ENV is useless as a discriminator in both directions: it defaults
 * to 'development' from a laptop running against production through a
 * proxy, and Dockerfile bakes 'production' into the container regardless
 * of which database it is pointed at.
 */
describe('assertPurgeTarget', () => {
  const PROD = 'postgresql://user:pw@10.20.0.3:5432/outvers'

  it('accepts the production database', () => {
    expect(() => assertPurgeTarget(PROD)).not.toThrow()
  })

  it('accepts production through a Cloud SQL Auth Proxy on localhost', () => {
    expect(() =>
      assertPurgeTarget('postgresql://user:pw@127.0.0.1:5432/outvers'),
    ).not.toThrow()
  })

  // The prefix collision — the whole reason this module exists.
  it.each([
    ['the local dev database', 'postgresql://me@localhost:5544/outvers_dev'],
    ['the E2E database', 'postgresql://me@localhost:5544/outvers_e2e'],
    ['the pre-launch E2E database', 'postgresql://me@localhost:5544/outvers_e2e_prelaunch'],
    ['the maintenance database', 'postgresql://me@localhost:5544/postgres'],
    ['a lookalike suffix', 'postgresql://me@localhost:5432/outvers_backup'],
    ['a lookalike prefix', 'postgresql://me@localhost:5432/not_outvers'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertPurgeTarget(url)).toThrow(/refusing/i)
  })

  it('names the offending database in the error, without leaking the password', () => {
    let message = ''
    try {
      assertPurgeTarget('postgresql://user:sup3rs3cret@localhost:5544/outvers_dev')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('outvers_dev')
    expect(message).toContain(PRODUCTION_DB_NAME)
    expect(message).not.toContain('sup3rs3cret')
  })

  it('tolerates a query string on the connection URL', () => {
    expect(() =>
      assertPurgeTarget('postgresql://u:p@10.0.0.1:5432/outvers?sslmode=require'),
    ).not.toThrow()
    expect(() =>
      assertPurgeTarget('postgresql://u:p@localhost:5544/outvers_dev?sslmode=disable'),
    ).toThrow(/refusing/i)
  })

  it.each([
    ['an empty string', ''],
    ['a non-URL', 'not-a-url'],
    ['a URL with no database path', 'postgresql://user:pw@localhost:5432'],
    ['undefined', undefined],
  ])('refuses %s rather than guessing', (_label, url) => {
    expect(() => assertPurgeTarget(url as string)).toThrow()
  })
})

describe('describeTarget', () => {
  it('renders host and database for the operator, never the password', () => {
    const described = describeTarget('postgresql://admin:hunter2@10.20.0.3:5432/outvers')
    expect(described).toContain('10.20.0.3')
    expect(described).toContain('outvers')
    expect(described).not.toContain('hunter2')
    expect(described).not.toContain('admin')
  })
})
