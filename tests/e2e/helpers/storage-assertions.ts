/**
 * Storage-mock assertion helpers for E2E (Issue #17).
 *
 * Image uploads go through LocalFileAdapter (lib/storage/local.ts), which
 * writes files under `public/uploads/<storageKey>` relative to the dev
 * server's CWD (the repo root). These helpers let the spec assert that an
 * upload landed on disk and that a delete removed it, proving the
 * upload/delete actions exercise the storage mock end-to-end.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Repo root, derived from this file's location (tests/e2e/helpers → ../../..). */
const REPO_ROOT = resolve(__dirname, '../../..')
const UPLOADS_DIR = resolve(REPO_ROOT, 'public/uploads')

/** True if the storage mock has a file at the given storage key. */
export function storageFileExists(storageKey: string): boolean {
  return existsSync(resolve(UPLOADS_DIR, storageKey))
}
