/**
 * Private storage contract — for files that must NEVER be world-readable.
 *
 * This is deliberately a SEPARATE interface from `StorageAdapter` rather than
 * extra methods on it. The public adapter targets a bucket whose IAM grants
 * `allUsers: objectViewer`, so anything written through it is fetchable by
 * anyone holding the URL, with no auth check and no expiry. KYC documents
 * (Aadhaar, PAN, government ID, selfie) are sensitive personal identifiers and
 * cannot live there.
 *
 * The split is what makes the mistake unrepresentable: a private adapter has
 * no `getUrl()`, so there is no durable public link to accidentally persist,
 * log, or render. Reads go through a short-lived signed URL (GCS) or an
 * auth-gated stream (local dev).
 */
export interface PrivateStorageAdapter {
  /**
   * Store a file privately. Returns ONLY the storage key — deliberately no
   * URL, because a durable link to a KYC document should not exist.
   */
  upload(file: File, key: string): Promise<{ storageKey: string }>

  /**
   * A time-limited URL for reading the object. Implementations cap the
   * lifetime; a leaked link must stop working quickly.
   */
  getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string>

  /** Read the bytes directly (used to stream through an auth-gated route). */
  read(storageKey: string): Promise<{ body: Buffer; contentType: string } | null>

  delete(storageKey: string): Promise<void>
}

/**
 * Ceiling on signed-URL lifetime. A caller asking for longer gets this — the
 * blast radius of a leaked KYC link is bounded by policy, not by the caller.
 */
export const MAX_SIGNED_URL_TTL_SECONDS = 60 * 60
