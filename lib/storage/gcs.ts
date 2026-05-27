import type { StorageAdapter } from './adapter'

/**
 * Google Cloud Storage adapter stub. Implements StorageAdapter so the
 * application can reference it, but throws at runtime until GCS
 * credentials are wired (expected: M3 or later).
 *
 * Production deployments should swap to R2Adapter (see r2.ts) or
 * implement this stub against the @google-cloud/storage SDK.
 */
export class GcsAdapter implements StorageAdapter {
  private readonly bucket: string

  constructor(bucket: string) {
    this.bucket = bucket
  }

  async upload(
    _file: File,
    _key: string,
  ): Promise<{ url: string; storageKey: string }> {
    throw new Error(
      `GcsAdapter.upload not implemented — bucket "${this.bucket}". Wire @google-cloud/storage or use LocalFileAdapter for dev.`,
    )
  }

  getUrl(storageKey: string): string {
    return `https://storage.googleapis.com/${this.bucket}/${storageKey}`
  }

  async delete(_storageKey: string): Promise<void> {
    throw new Error(
      `GcsAdapter.delete not implemented — bucket "${this.bucket}". Wire @google-cloud/storage or use LocalFileAdapter for dev.`,
    )
  }
}
