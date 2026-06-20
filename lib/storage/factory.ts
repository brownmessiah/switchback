import { env } from '@/lib/env'

import type { StorageAdapter } from './adapter'
import { GcsAdapter } from './gcs'
import { LocalFileAdapter } from './local'

/**
 * Storage backend selection (ADR-0019). Returns the GCS adapter when a bucket is
 * configured (prod / Cloud Run), and the local-disk adapter otherwise (dev /
 * test). `STORAGE_BACKEND=local` forces local even when a bucket is set (handy
 * for a local run against a copy of prod env). Defaults to the parsed `env`;
 * tests pass an explicit config so selection is verifiable without process.env.
 */
export interface StorageConfig {
  STORAGE_BACKEND?: string
  GCS_BUCKET?: string
}

export function getStorageAdapter(config: StorageConfig = env): StorageAdapter {
  if (config.GCS_BUCKET && config.STORAGE_BACKEND !== 'local') {
    return new GcsAdapter(config.GCS_BUCKET)
  }
  return new LocalFileAdapter()
}
