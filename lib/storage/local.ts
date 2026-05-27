import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { StorageAdapter } from './adapter'

/**
 * Local filesystem adapter for demo / development use. Writes files
 * under `public/uploads/` so Next.js serves them as static assets.
 *
 * NOT for production — no CDN, no signed URLs, no deduplication.
 */
export class LocalFileAdapter implements StorageAdapter {
  private readonly baseDir: string
  private readonly urlPrefix: string

  constructor(baseDir = 'public/uploads', urlPrefix = '/uploads') {
    this.baseDir = baseDir
    this.urlPrefix = urlPrefix
  }

  async upload(
    file: File,
    key: string,
  ): Promise<{ url: string; storageKey: string }> {
    const filePath = join(this.baseDir, key)
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    writeFileSync(filePath, buffer)
    return {
      url: `${this.urlPrefix}/${key}`,
      storageKey: key,
    }
  }

  getUrl(storageKey: string): string {
    return `${this.urlPrefix}/${storageKey}`
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = join(this.baseDir, storageKey)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }
}
