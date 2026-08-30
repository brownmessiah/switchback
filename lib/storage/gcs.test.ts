import type { Storage } from '@google-cloud/storage'
import { describe, expect, it } from 'vitest'

import { GcsAdapter } from './gcs'

/**
 * GcsAdapter contract (ADR-0019). GCS network calls are stubbed via an injected
 * fake Storage client so the test asserts key/URL derivation + the upload/delete
 * surface without hitting the network. Mirrors lib/storage/local.test.ts.
 */

interface SaveCall {
  bucket: string
  key: string
  buffer: Buffer
  contentType?: string
}
interface DeleteCall {
  bucket: string
  key: string
  ignoreNotFound?: boolean
}

function makeFakeStorage(opts: { deleteThrowsWithoutIgnore?: boolean } = {}) {
  const saves: SaveCall[] = []
  const deletes: DeleteCall[] = []
  const client = {
    bucket: (bucket: string) => ({
      file: (key: string) => ({
        save: async (buffer: Buffer, options?: { contentType?: string }) => {
          saves.push({ bucket, key, buffer, contentType: options?.contentType })
        },
        delete: async (options?: { ignoreNotFound?: boolean }) => {
          deletes.push({ bucket, key, ignoreNotFound: options?.ignoreNotFound })
          if (opts.deleteThrowsWithoutIgnore && !options?.ignoreNotFound) {
            throw new Error('No such object')
          }
          return [{}]
        },
      }),
    }),
  }
  return { client: client as unknown as Storage, saves, deletes }
}

describe('GcsAdapter', () => {
  describe('getUrl', () => {
    it('derives the public GCS object URL', () => {
      const adapter = new GcsAdapter('switchback-uploads', makeFakeStorage().client)
      expect(adapter.getUrl('experiences/abc/photo.jpg')).toBe(
        'https://storage.googleapis.com/switchback-uploads/experiences/abc/photo.jpg',
      )
    })
  })

  describe('upload', () => {
    it('saves the file bytes to the bucket and returns the public url + key', async () => {
      const { client, saves } = makeFakeStorage()
      const adapter = new GcsAdapter('switchback-uploads', client)
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic
      const file = new File([bytes], 'p.png', { type: 'image/png' })

      const result = await adapter.upload(file, 'experiences/abc/p.png')

      expect(result).toEqual({
        url: 'https://storage.googleapis.com/switchback-uploads/experiences/abc/p.png',
        storageKey: 'experiences/abc/p.png',
      })
      expect(saves).toHaveLength(1)
      expect(saves[0]!.bucket).toBe('switchback-uploads')
      expect(saves[0]!.key).toBe('experiences/abc/p.png')
      expect(saves[0]!.contentType).toBe('image/png')
      expect(saves[0]!.buffer[0]).toBe(0x89)
      expect(saves[0]!.buffer[1]).toBe(0x50)
    })

    it('falls back to a generic content type when the file has none', async () => {
      const { client, saves } = makeFakeStorage()
      const adapter = new GcsAdapter('b', client)
      const file = new File(['x'], 'f', { type: '' })
      await adapter.upload(file, 'k')
      expect(saves[0]!.contentType).toBe('application/octet-stream')
    })
  })

  describe('delete', () => {
    it('deletes the object with ignoreNotFound and does not throw when missing', async () => {
      const { client, deletes } = makeFakeStorage({ deleteThrowsWithoutIgnore: true })
      const adapter = new GcsAdapter('switchback-uploads', client)
      await expect(adapter.delete('experiences/abc/p.png')).resolves.toBeUndefined()
      expect(deletes).toHaveLength(1)
      expect(deletes[0]!.key).toBe('experiences/abc/p.png')
      expect(deletes[0]!.ignoreNotFound).toBe(true)
    })
  })
})
