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
    it('returns a fallback S3Client when R2 credentials are absent', () => {
      const client = getR2Client()
      expect(client).toBeDefined()
    })
  })

  describe('getR2BucketName', () => {
    it('returns demo bucket name when R2_BUCKET is unset', () => {
      expect(getR2BucketName()).toBe('outvers-demo')
    })
  })
})
