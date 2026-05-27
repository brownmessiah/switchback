import { describe, expect, it } from 'vitest'

import { GcsAdapter } from './gcs'

describe('GcsAdapter (stub)', () => {
  const adapter = new GcsAdapter('test-bucket')

  describe('upload', () => {
    it('throws not-implemented error', async () => {
      const file = new File(['test'], 'test.png', { type: 'image/png' })
      await expect(adapter.upload(file, 'key')).rejects.toThrow(
        /GcsAdapter\.upload not implemented/,
      )
    })
  })

  describe('getUrl', () => {
    it('returns a GCS public URL', () => {
      const url = adapter.getUrl('images/photo.jpg')
      expect(url).toBe('https://storage.googleapis.com/test-bucket/images/photo.jpg')
    })
  })

  describe('delete', () => {
    it('throws not-implemented error', async () => {
      await expect(adapter.delete('key')).rejects.toThrow(
        /GcsAdapter\.delete not implemented/,
      )
    })
  })
})
