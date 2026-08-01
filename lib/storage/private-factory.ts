import { env } from '@/lib/env'

import { GcsPrivateAdapter } from './gcs-private'
import { LocalPrivateAdapter } from './local-private'
import type { PrivateStorageAdapter } from './private-adapter'

/**
 * Private storage backend selection.
 *
 * Deliberately keyed on `GCS_KYC_BUCKET` ALONE. It must never fall back to
 * `GCS_BUCKET`: that bucket's IAM grants `allUsers: objectViewer`, so a
 * fallback would silently publish every KYC document the moment the dedicated
 * bucket was missing — a misconfiguration that fails open. With no private
 * bucket configured we degrade to local disk instead, which is inconvenient
 * in production but never leaks.
 */
export interface PrivateStorageConfig {
  STORAGE_BACKEND?: string
  /** Dedicated PRIVATE bucket. Has no public IAM binding. */
  GCS_KYC_BUCKET?: string
  /** Present only so a caller passing the whole env cannot accidentally match it. */
  GCS_BUCKET?: string
}

export function getPrivateStorageAdapter(
  config: PrivateStorageConfig = env,
): PrivateStorageAdapter {
  if (config.GCS_KYC_BUCKET && config.STORAGE_BACKEND !== 'local') {
    return new GcsPrivateAdapter(config.GCS_KYC_BUCKET)
  }
  return new LocalPrivateAdapter()
}
