import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LocalFileAdapter } from './local'

const TEST_DIR = join(process.cwd(), '.test-uploads')
const URL_PREFIX = '/test-uploads'

describe('LocalFileAdapter', () => {
  let adapter: LocalFileAdapter

  beforeAll(() => {
    adapter = new LocalFileAdapter(TEST_DIR, URL_PREFIX)
    // Ensure clean state
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  describe('upload', () => {
    it('creates file in the base directory and returns url + key', async () => {
      const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
      const file = new File([content], 'test.png', { type: 'image/png' })

      const result = await adapter.upload(file, 'experiences/abc/test.png')

      expect(result.url).toBe('/test-uploads/experiences/abc/test.png')
      expect(result.storageKey).toBe('experiences/abc/test.png')

      const filePath = join(TEST_DIR, 'experiences/abc/test.png')
      expect(existsSync(filePath)).toBe(true)

      const written = readFileSync(filePath)
      expect(written[0]).toBe(0x89)
      expect(written[1]).toBe(0x50)
    })

    it('creates nested directories as needed', async () => {
      const file = new File(['hello'], 'deep.txt', { type: 'text/plain' })
      const result = await adapter.upload(file, 'a/b/c/deep.txt')

      expect(result.storageKey).toBe('a/b/c/deep.txt')
      expect(existsSync(join(TEST_DIR, 'a/b/c/deep.txt'))).toBe(true)
    })
  })

  describe('getUrl', () => {
    it('returns the correct path for a storage key', () => {
      const url = adapter.getUrl('experiences/abc/test.png')
      expect(url).toBe('/test-uploads/experiences/abc/test.png')
    })

    it('returns correct path for nested keys', () => {
      const url = adapter.getUrl('vendors/v1/kyc/doc.pdf')
      expect(url).toBe('/test-uploads/vendors/v1/kyc/doc.pdf')
    })
  })

  describe('delete', () => {
    it('removes an existing file', async () => {
      // First upload a file
      const file = new File(['delete-me'], 'to-delete.txt', { type: 'text/plain' })
      await adapter.upload(file, 'temp/to-delete.txt')
      expect(existsSync(join(TEST_DIR, 'temp/to-delete.txt'))).toBe(true)

      // Then delete it
      await adapter.delete('temp/to-delete.txt')
      expect(existsSync(join(TEST_DIR, 'temp/to-delete.txt'))).toBe(false)
    })

    it('does not throw when file does not exist', async () => {
      await expect(adapter.delete('nonexistent/file.png')).resolves.toBeUndefined()
    })
  })
})
