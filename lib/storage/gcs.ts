import { Storage } from '@google-cloud/storage'

import type { StorageAdapter } from './adapter'

/**
 * Google Cloud Storage adapter (ADR-0019). Targets a PUBLIC bucket with uniform
 * bucket-level access (the bucket IAM grants `allUsers:objectViewer`, so objects
 * are world-readable without per-object ACLs), keeping `getUrl()` a plain
 * `https://storage.googleapis.com/<bucket>/<key>` — the host already allow-listed
 * in `next.config`.
 *
 * Auth is ADC: on Cloud Run the attached service account is used automatically —
 * no key files. The `Storage` client is created lazily on first use so
 * constructing the adapter (and `getUrl`) never touches GCP credentials (keeps
 * the factory + tests credential-free).
 *
 * Forward guardrail (ADR-0019): sensitive uploads (KYC docs, invoices, payout
 * statements) must NOT use this public adapter — they go in a separate PRIVATE
 * bucket served via signed URLs (future M3).
 */
export class GcsAdapter implements StorageAdapter {
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

  async upload(
    file: File,
    key: string,
  ): Promise<{ url: string; storageKey: string }> {
    const buffer = Buffer.from(await file.arrayBuffer())
    await this.getClient()
      .bucket(this.bucket)
      .file(key)
      .save(buffer, {
        contentType: file.type || 'application/octet-stream',
        // Small image uploads — a single-shot (non-resumable) write is simpler
        // and avoids a resumable-session round-trip.
        resumable: false,
      })
    return { url: this.getUrl(key), storageKey: key }
  }

  getUrl(storageKey: string): string {
    return `https://storage.googleapis.com/${this.bucket}/${storageKey}`
  }

  async delete(storageKey: string): Promise<void> {
    // `ignoreNotFound` mirrors LocalFileAdapter.delete (a missing object is not
    // an error — callers delete best-effort during edits).
    await this.getClient()
      .bucket(this.bucket)
      .file(storageKey)
      .delete({ ignoreNotFound: true })
  }
}
