import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { vendorKycDocuments } from '@/db/schema/vendor-kyc-documents'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { getPrivateStorageAdapter } from '@/lib/storage/private-factory'
import { MAX_SIGNED_URL_TTL_SECONDS } from '@/lib/storage/private-adapter'

/**
 * The ONLY path to a Vendor KYC document.
 *
 * These objects live in a bucket with no public IAM binding, so there is no
 * unauthenticated way to reach them. This route re-checks the caller's admin
 * `vendors` permission on every request and then either:
 *   - redirects to a freshly-minted, short-lived v4 signed URL (GCS), or
 *   - streams the bytes (local dev, where signing does not exist).
 *
 * Signed URLs are minted per request rather than stored, so a link that leaks
 * out of an admin's history expires quickly and cannot be re-shared usefully.
 *
 * The `key` is validated against `vendor_kyc_documents` rather than trusted:
 * without that check this would be an arbitrary-object reader for the whole
 * private bucket.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (!(await hasAdminPermission(db, session.user.id, 'vendors'))) {
    // 404 rather than 403 — do not confirm to a non-admin that a given
    // document key exists.
    return new NextResponse('Not found', { status: 404 })
  }

  const key = new URL(request.url).searchParams.get('key')
  if (!key) {
    return new NextResponse('Missing key', { status: 400 })
  }

  // Only keys we actually issued are readable.
  const [document] = await db
    .select({ storageKey: vendorKycDocuments.storageKey })
    .from(vendorKycDocuments)
    .where(eq(vendorKycDocuments.storageKey, key))
    .limit(1)

  if (!document) {
    return new NextResponse('Not found', { status: 404 })
  }

  const storage = getPrivateStorageAdapter()
  const signed = await storage.getSignedUrl(document.storageKey, MAX_SIGNED_URL_TTL_SECONDS)

  // The GCS adapter returns an absolute signed URL; the local adapter returns
  // a path back to this route, which would loop — so stream in that case.
  if (/^https?:\/\//.test(signed)) {
    return NextResponse.redirect(signed)
  }

  const file = await storage.read(document.storageKey)
  if (!file) {
    return new NextResponse('Not found', { status: 404 })
  }

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      'Content-Type': file.contentType,
      // Never cached by a shared cache, and shown inline for review.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    },
  })
}
