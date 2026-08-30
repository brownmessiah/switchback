import { describe, expect, it } from 'vitest'

import { getStorageAdapter } from './factory'
import { GcsAdapter } from './gcs'
import { LocalFileAdapter } from './local'

/**
 * Storage backend selection (ADR-0019). GCS in prod (when configured), local in
 * dev. Config is passed explicitly so the selection is tested without depending
 * on process.env.
 */
describe('getStorageAdapter', () => {
  it('returns GcsAdapter when STORAGE_BACKEND=gcs and GCS_BUCKET is set', () => {
    expect(getStorageAdapter({ STORAGE_BACKEND: 'gcs', GCS_BUCKET: 'switchback-uploads' })).toBeInstanceOf(
      GcsAdapter,
    )
  })

  it('returns GcsAdapter when GCS_BUCKET is set even if STORAGE_BACKEND is unset', () => {
    expect(getStorageAdapter({ GCS_BUCKET: 'switchback-uploads' })).toBeInstanceOf(GcsAdapter)
  })

  it('returns LocalFileAdapter when no GCS config is present', () => {
    expect(getStorageAdapter({})).toBeInstanceOf(LocalFileAdapter)
  })

  it('returns LocalFileAdapter when STORAGE_BACKEND=local even if GCS_BUCKET is set', () => {
    expect(getStorageAdapter({ STORAGE_BACKEND: 'local', GCS_BUCKET: 'switchback-uploads' })).toBeInstanceOf(
      LocalFileAdapter,
    )
  })
})
