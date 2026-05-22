import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _resetRedisCacheForTests, getRedis } from './redis'

describe('getRedis', () => {
  beforeEach(() => {
    _resetRedisCacheForTests()
  })

  afterEach(() => {
    _resetRedisCacheForTests()
  })

  it('returns a stub client when UPSTASH credentials are absent', async () => {
    const r = getRedis()
    expect(typeof r.get).toBe('function')
    expect(typeof r.set).toBe('function')
    await expect(r.get('any-key')).resolves.toBeNull()
    await expect(r.set('k', 'v')).resolves.toBe('OK')
  })

  it('caches the instance across calls', () => {
    const first = getRedis()
    const second = getRedis()
    expect(first).toBe(second)
  })
})
