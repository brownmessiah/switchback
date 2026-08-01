import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import type { PrivateStorageAdapter } from './private-adapter'

/**
 * Local-disk private storage for development and tests.
 *
 * Writes OUTSIDE `public/` on purpose — anything under `public/` is served
 * statically by Next.js with no auth check, which is exactly the exposure this
 * adapter exists to avoid. The default base lives under the gitignored
 * `.dev-stack/` so KYC test fixtures never reach a commit.
 *
 * NOT for production: there is no signing here, so `getSignedUrl` returns a
 * path into the admin-gated streaming route instead.
 */
export class LocalPrivateAdapter implements PrivateStorageAdapter {
  private readonly baseDir: string

  constructor(baseDir = join(process.cwd(), '.dev-stack', 'private-uploads')) {
    this.baseDir = resolve(baseDir)
  }

  /**
   * Resolve a caller-supplied key inside the base directory, refusing any key
   * that escapes it. Keys are derived from user-influenced values, so `../`
   * traversal is a real path — and writing through it could land a KYC
   * document in `public/uploads/`, the very bucket this class avoids.
   */
  private resolveKey(key: string): string {
    const full = resolve(this.baseDir, key)
    const rel = relative(this.baseDir, full)
    if (rel.startsWith('..') || resolve(this.baseDir, rel) !== full) {
      throw new Error(`Invalid storage key (path traversal): ${key}`)
    }
    return full
  }

  async upload(file: File, key: string): Promise<{ storageKey: string }> {
    const filePath = this.resolveKey(key)
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    writeFileSync(filePath, Buffer.from(await file.arrayBuffer()))
    writeFileSync(
      `${filePath}.meta`,
      JSON.stringify({ contentType: file.type || 'application/octet-stream' }),
    )

    return { storageKey: key }
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    // No signing locally — point at the admin-gated streaming route, which
    // performs the same permission check the signed URL would stand in for.
    return `/api/admin/kyc-document?key=${encodeURIComponent(storageKey)}`
  }

  async read(
    storageKey: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const filePath = this.resolveKey(storageKey)
    if (!existsSync(filePath)) return null

    let contentType = 'application/octet-stream'
    if (existsSync(`${filePath}.meta`)) {
      try {
        const meta = JSON.parse(readFileSync(`${filePath}.meta`, 'utf-8')) as {
          contentType?: string
        }
        contentType = meta.contentType ?? contentType
      } catch {
        // A corrupt sidecar must not block reading the document itself.
      }
    }

    return { body: readFileSync(filePath), contentType }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = this.resolveKey(storageKey)
    if (existsSync(filePath)) unlinkSync(filePath)
    if (existsSync(`${filePath}.meta`)) unlinkSync(`${filePath}.meta`)
  }
}
