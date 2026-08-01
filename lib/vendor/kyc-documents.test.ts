import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorKycDocuments } from '@/db/schema/vendor-kyc-documents'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { PrivateStorageAdapter } from '@/lib/storage/private-adapter'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeUploadKycDocument,
  listKycDocumentsForVendor,
  MAX_KYC_DOCUMENT_BYTES,
} from './kyc-documents'

/**
 * The ADR-0007 interim verification path: PAN + government ID + selfie,
 * reviewed manually. Before this there was nowhere for that evidence to go —
 * the onboarding wizard said document upload "will be available when external
 * services are connected", and the admin Evidence Cockpit rendered fields no
 * Vendor UI could write.
 *
 * These are sensitive personal identifiers, so the tests below care as much
 * about where the bytes DON'T go as about the happy path.
 */

function recordingAdapter(): {
  adapter: PrivateStorageAdapter
  uploads: { key: string; bytes: number }[]
} {
  const uploads: { key: string; bytes: number }[] = []
  return {
    uploads,
    adapter: {
      async upload(file, key) {
        uploads.push({ key, bytes: file.size })
        return { storageKey: key }
      },
      async getSignedUrl(key) {
        return `https://signed.example/${key}`
      },
      async read() {
        return null
      },
      async delete() {},
    },
  }
}

function fileOf(bytes: number, type = 'image/jpeg', name = 'id.jpg'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function seedVendor(db: TestDB, userId: string): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId,
    businessName: `Business ${userId}`,
    slug: `slug-${userId}`,
  })
}

describe('vendor KYC documents', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE vendor_kyc_documents, vendor_profiles, users CASCADE`,
    )
  })

  it('stores the document and registers it against the Vendor', async () => {
    await seedVendor(db, 'v1')
    const { adapter, uploads } = recordingAdapter()

    const result = await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(1024),
    })

    expect(result.ok).toBe(true)
    expect(uploads).toHaveLength(1)

    const rows = await db
      .select()
      .from(vendorKycDocuments)
      .where(eq(vendorKycDocuments.vendorUserId, 'v1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('government_id')
    expect(rows[0]?.sizeBytes).toBe(1024)
  })

  it('namespaces the storage key under the Vendor so keys never collide', async () => {
    await seedVendor(db, 'v1')
    const { adapter, uploads } = recordingAdapter()

    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(10),
    })

    expect(uploads[0]?.key).toMatch(/^vendor-kyc\/v1\//)
  })

  it('gives each upload an unguessable key, not the original filename', async () => {
    // The filename is attacker-controlled and predictable; the key must not be.
    await seedVendor(db, 'v1')
    const { adapter, uploads } = recordingAdapter()

    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(10, 'image/jpeg', 'aadhaar-front.jpg'),
    })

    expect(uploads[0]?.key).not.toContain('aadhaar-front')
  })

  it('refuses a file type that is not an image or PDF', async () => {
    await seedVendor(db, 'v1')
    const { adapter, uploads } = recordingAdapter()

    const result = await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(10, 'application/x-msdownload', 'payload.exe'),
    })

    expect(result.ok).toBe(false)
    expect(uploads).toHaveLength(0)
  })

  it('refuses a file over the size cap', async () => {
    await seedVendor(db, 'v1')
    const { adapter, uploads } = recordingAdapter()

    const result = await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(MAX_KYC_DOCUMENT_BYTES + 1),
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/large|size|MB/i)
    expect(uploads).toHaveLength(0)
  })

  it('refuses an empty file', async () => {
    await seedVendor(db, 'v1')
    const { adapter } = recordingAdapter()

    const result = await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(0),
    })

    expect(result.ok).toBe(false)
  })

  it('refuses to register a document against a Vendor that does not exist', async () => {
    const { adapter, uploads } = recordingAdapter()

    const result = await executeUploadKycDocument(db, adapter, 'ghost', {
      kind: 'government_id',
      file: fileOf(10),
    })

    expect(result.ok).toBe(false)
    expect(uploads).toHaveLength(0)
  })

  it('replaces a previous document of the same kind rather than piling them up', async () => {
    await seedVendor(db, 'v1')
    const { adapter } = recordingAdapter()

    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(10),
    })
    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(20),
    })

    const rows = await db
      .select()
      .from(vendorKycDocuments)
      .where(eq(vendorKycDocuments.vendorUserId, 'v1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sizeBytes).toBe(20)
  })

  it('keeps different kinds side by side', async () => {
    await seedVendor(db, 'v1')
    const { adapter } = recordingAdapter()

    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(10),
    })
    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'selfie',
      file: fileOf(10),
    })

    const rows = await listKycDocumentsForVendor(db, 'v1')
    expect(rows.map((r) => r.kind).sort()).toEqual(['government_id', 'selfie'])
  })

  it('lists only the requested Vendor documents', async () => {
    await seedVendor(db, 'v1')
    await seedVendor(db, 'v2')
    const { adapter } = recordingAdapter()
    await executeUploadKycDocument(db, adapter, 'v1', {
      kind: 'government_id',
      file: fileOf(10),
    })
    await executeUploadKycDocument(db, adapter, 'v2', {
      kind: 'government_id',
      file: fileOf(10),
    })

    const rows = await listKycDocumentsForVendor(db, 'v1')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.vendorUserId).toBe('v1')
  })
})
