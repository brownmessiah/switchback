import { Storage } from '@google-cloud/storage'

import {
  MAX_SIGNED_URL_TTL_SECONDS,
  type PrivateStorageAdapter,
} from './private-adapter'

/**
 * Google Cloud Storage adapter for the PRIVATE bucket (ADR-0019 forward
 * guardrail, now implemented).
 *
 * The target bucket has NO `allUsers` IAM binding, so objects are unreachable
 * without credentials. Reads are served by v4 signed URLs minted per request
 * and capped at `MAX_SIGNED_URL_TTL_SECONDS`, so a link that leaks out of an
 * admin's browser history stops working quickly.
 *
 * Auth is ADC — on Cloud Run the attached service account signs. The client is
 * created lazily so constructing the adapter never touches GCP credentials
 * (keeps the factory and its tests credential-free).
 */
export class GcsPrivateAdapter implements PrivateStorageAdapter {
  private readonly bucket: string
  private client: Storage | undefined

  constructor(bucket: string, client?: Storage) {
    this.bucket = bucket
    this.client = client
  }

  private getClient(): Storage {
    if (!this.client) {
      this.client = new Storage()
    }
    return this.client
  }

  async upload(file: File, key: string): Promise<{ storageKey: string }> {
    const buffer = Buffer.from(await file.arrayBuffer())
    await this.getClient()
      .bucket(this.bucket)
      .file(key)
      .save(buffer, {
        contentType: file.type || 'application/octet-stream',
        resumable: false,
      })
    // No URL is returned, by design — see PrivateStorageAdapter.
    return { storageKey: key }
  }

  async getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    const ttl = Math.min(Math.max(ttlSeconds, 1), MAX_SIGNED_URL_TTL_SECONDS)
    const [url] = await this.getClient()
      .bucket(this.bucket)
      .file(storageKey)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + ttl * 1000,
      })
    return url
  }

  async read(
    storageKey: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const file = this.getClient().bucket(this.bucket).file(storageKey)
    const [exists] = await file.exists()
    if (!exists) return null

    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()])
    return {
      body: buffer,
      contentType: metadata.contentType ?? 'application/octet-stream',
    }
  }

  async delete(storageKey: string): Promise<void> {
    await this.getClient()
      .bucket(this.bucket)
      .file(storageKey)
      .delete({ ignoreNotFound: true })
  }
}
