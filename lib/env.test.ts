import { describe, expect, it } from 'vitest'

import { parseEnv } from './env'

describe('parseEnv', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/)
  })

  it('throws when DATABASE_URL is empty string', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: '',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      }),
    ).toThrow(/DATABASE_URL/)
  })

  it('throws when BETTER_AUTH_SECRET is shorter than 32 chars', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        BETTER_AUTH_SECRET: 'too-short',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      }),
    ).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('throws when NEXT_PUBLIC_APP_URL is missing', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
      }),
    ).toThrow(/NEXT_PUBLIC_APP_URL/)
  })

  it('parses a valid env object with defaults applied', () => {
    const parsed = parseEnv({
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
    expect(parsed.DATABASE_URL).toBe('postgres://user:pass@host:5432/db')
    expect(parsed.NODE_ENV).toBe('development')
  })

  it('accepts and preserves optional service credentials when present', () => {
    const parsed = parseEnv({
      DATABASE_URL: 'postgres://x',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      MSG91_AUTH_KEY: 'msg-key',
      OPENAI_API_KEY: 'sk-test-abc',
    })
    expect(parsed.RAZORPAY_KEY_ID).toBe('rzp_test_abc')
    expect(parsed.MSG91_AUTH_KEY).toBe('msg-key')
    expect(parsed.OPENAI_API_KEY).toBe('sk-test-abc')
  })

  it('rejects unknown NODE_ENV values', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgres://x',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        NODE_ENV: 'staging',
      }),
    ).toThrow(/NODE_ENV/)
  })
})
