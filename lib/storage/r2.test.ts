import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _resetR2CacheForTests, getR2BucketName, getR2Client } from './r2'

describe('R2 storage wiring', () => {
  beforeEach(() => {
    _resetR2CacheForTests()
  })

  afterEach(() => {
    _resetR2CacheForTests()
  })

  describe('getR2Client', () => {
    it('throws a descriptive error when R2 credentials are absent', () => {
      expect(() => getR2Client()).toThrow(/R2_ACCESS_KEY_ID/)
    })
  })

  describe('getR2BucketName', () => {
    it('throws when R2_BUCKET is unset', () => {
      expect(() => getR2BucketName()).toThrow(/R2_BUCKET/)
    })
  })
})
