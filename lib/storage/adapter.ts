/**
 * Storage adapter interface. All file-storage implementations (local FS,
 * Cloudflare R2, GCS) conform to this contract so the application layer
 * never couples to a specific backend.
 */
export interface StorageAdapter {
  /** Upload a file and return the public URL + storage key. */
  upload(file: File, key: string): Promise<{ url: string; storageKey: string }>

  /** Resolve a storage key to a publicly-reachable URL. */
  getUrl(storageKey: string): string

  /** Delete a file by its storage key. */
  delete(storageKey: string): Promise<void>
}
