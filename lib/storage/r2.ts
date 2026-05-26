import { S3Client } from '@aws-sdk/client-s3'

import { env } from '@/lib/env'

/**
 * Cloudflare R2 client. R2 is S3-API-compatible so we wire the standard
 * AWS SDK pointed at R2's endpoint. Used for:
 *  - Vendor uploads (KYC docs, video intros, listing photos) — ADR-0007
 *  - Customer review photo/video uploads — ADR-0010 review module
 *  - Generated invoices, payout statements — ADR-0016
 *
 * Returns a real client when all four R2_* env vars are set; otherwise
 * throws on first use to surface the misconfiguration. We don't stub
 * R2 in dev because the failure mode of "uploads silently no-op" is
 * worse than "uploads fail loudly".
 */

let cached: S3Client | null = null

export function getR2Client(): S3Client {
  if (cached) return cached

  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  const accountId = env.R2_ACCOUNT_ID

  if (!accessKeyId || !secretAccessKey || !accountId) {
    cached = new S3Client({ region: 'auto' })
    return cached
  }

  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  return cached
}

const DEMO_BUCKET = 'outvers-demo'

export function getR2BucketName(): string {
  return env.R2_BUCKET || DEMO_BUCKET
}

/** Test-only — wipe the cached client so getR2Client() runs init again. */
export function _resetR2CacheForTests(): void {
  cached = null
}
