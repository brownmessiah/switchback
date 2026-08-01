import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import {
  vendorKycDocuments,
  type VendorKycDocument,
} from '@/db/schema/vendor-kyc-documents'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import type { PrivateStorageAdapter } from '@/lib/storage/private-adapter'

/**
 * Vendor KYC evidence capture — the ADR-0007 interim verification path.
 *
 * ADR-0007's Tier-2 gate assumes Aadhaar OTP eKYC, which is not integrated, so
 * the ADR's own documented fallback (PAN + government ID + selfie, reviewed
 * manually by an admin) is the live path. This is where that evidence lands.
 *
 * These are sensitive personal identifiers, so the rules here are about
 * containment as much as correctness:
 *   - bytes go to the PRIVATE adapter only (no public bucket, no public URL);
 *   - keys are random, never derived from the attacker-controlled filename;
 *   - one document per kind, so re-uploading corrects rather than accumulates.
 */

export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number]

export const KYC_DOCUMENT_KINDS = [
  'government_id',
  'selfie',
  'pan_card',
  'business_proof',
] as const

/** 8 MB — comfortably fits a phone photo or a scanned PDF page. */
export const MAX_KYC_DOCUMENT_BYTES = 8 * 1024 * 1024

/**
 * Images and PDFs only. Anything executable or scriptable is refused outright:
 * these files are later handed back to an admin's browser, so an HTML or SVG
 * upload would be a stored-XSS vector against the admin console.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
])

export type KycDocumentUploadResult =
  | { ok: true; storageKey: string }
  | { ok: false; error: string }

export interface KycDocumentUploadInput {
  kind: KycDocumentKind
  file: File
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

/**
 * Upload one KYC document for a Vendor, replacing any previous document of the
 * same kind.
 *
 * `vendorUserId` is the SHOP (ownership); `actingUserId` is the human who
 * clicked, recorded for the audit trail.
 */
export async function executeUploadKycDocument(
  db: DBOrTx,
  storage: PrivateStorageAdapter,
  vendorUserId: string,
  input: KycDocumentUploadInput,
  actingUserId?: string,
): Promise<KycDocumentUploadResult> {
  if (!KYC_DOCUMENT_KINDS.includes(input.kind)) {
    return { ok: false, error: 'Unknown document type.' }
  }

  const { file } = input

  if (!file || file.size === 0) {
    return { ok: false, error: 'Choose a file to upload.' }
  }

  if (file.size > MAX_KYC_DOCUMENT_BYTES) {
    const maxMb = Math.floor(MAX_KYC_DOCUMENT_BYTES / (1024 * 1024))
    return { ok: false, error: `That file is too large. Maximum size is ${maxMb} MB.` }
  }

  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return {
      ok: false,
      error: 'Upload a JPG, PNG, WEBP, HEIC or PDF.',
    }
  }

  // Verify the Vendor exists BEFORE writing bytes — an upload with no owning
  // row would be an orphan in a bucket we deliberately never list publicly.
  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor profile not found.' }
  }

  // Random key: the original filename is attacker-controlled and predictable,
  // and these objects must not be guessable even inside a private bucket.
  const extension = EXTENSION_BY_TYPE[contentType] ?? 'bin'
  const storageKey = `vendor-kyc/${vendorUserId}/${input.kind}-${randomUUID()}.${extension}`

  const stored = await storage.upload(file, storageKey)

  // One document per kind: re-uploading corrects a bad scan rather than
  // leaving an admin to guess which of five files is current.
  const [previous] = await db
    .select({ id: vendorKycDocuments.id, storageKey: vendorKycDocuments.storageKey })
    .from(vendorKycDocuments)
    .where(
      and(
        eq(vendorKycDocuments.vendorUserId, vendorUserId),
        eq(vendorKycDocuments.kind, input.kind),
      ),
    )
    .limit(1)

  if (previous) {
    await db
      .delete(vendorKycDocuments)
      .where(eq(vendorKycDocuments.id, previous.id))
    // Best-effort: a stale object left behind is a cost problem, not a
    // correctness one, and must not fail the Vendor's upload.
    try {
      await storage.delete(previous.storageKey)
    } catch {
      // Intentionally ignored — the row is already gone.
    }
  }

  await db.insert(vendorKycDocuments).values({
    vendorUserId,
    kind: input.kind,
    storageKey: stored.storageKey,
    contentType,
    sizeBytes: file.size,
    originalFilename: file.name || null,
    uploadedBy: actingUserId ?? vendorUserId,
  })

  return { ok: true, storageKey: stored.storageKey }
}

/** Every KYC document a Vendor has supplied, for the admin Evidence Cockpit. */
export async function listKycDocumentsForVendor(
  db: DBOrTx,
  vendorUserId: string,
): Promise<VendorKycDocument[]> {
  return db
    .select()
    .from(vendorKycDocuments)
    .where(eq(vendorKycDocuments.vendorUserId, vendorUserId))
}
