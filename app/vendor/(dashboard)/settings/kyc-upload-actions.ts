'use server'

import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import {
  executeUploadKycDocument,
  KYC_DOCUMENT_KINDS,
  type KycDocumentKind,
  type KycDocumentUploadResult,
} from '@/lib/vendor/kyc-documents'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'
import { getPrivateStorageAdapter } from '@/lib/storage/private-factory'

/**
 * Server Action wrapper (auth layer) for KYC document upload.
 *
 * Resolves the acting Vendor context and gates `settings:manage` against the
 * RESOLVED shop before delegating to the db-injected core, which is NOT
 * exported from this `'use server'` file — every exported async function here
 * is a client-callable endpoint, and a core taking an arbitrary
 * `vendorUserId` would let anyone attach documents to anyone's Vendor.
 *
 * The bytes go to the PRIVATE storage adapter. They must never reach
 * `getStorageAdapter()`, whose bucket is world-readable.
 *
 * NOTE: this module may export ONLY async functions.
 */

const DENIED = 'You do not have permission to manage this vendor account.'

export async function uploadKycDocumentAction(
  formData: FormData,
): Promise<KycDocumentUploadResult> {
  const gate = await requireVendorActionContext('kyc:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  const kind = formData.get('kind')
  const file = formData.get('file')

  if (typeof kind !== 'string' || !KYC_DOCUMENT_KINDS.includes(kind as KycDocumentKind)) {
    return { ok: false, error: 'Unknown document type.' }
  }
  if (!(file instanceof File)) {
    return { ok: false, error: 'Choose a file to upload.' }
  }

  const result = await executeUploadKycDocument(
    prodDb,
    getPrivateStorageAdapter(),
    gate.shop,
    { kind: kind as KycDocumentKind, file },
    gate.acting,
  )

  if (result.ok) {
    revalidatePath('/vendor/settings')
    // The admin Evidence Cockpit gains a document to review.
    revalidatePath(`/admin/vendors/${gate.shop}`)
  }

  return result
}
