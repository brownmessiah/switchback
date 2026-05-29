'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { experiences, mediaAssets } from '@/db/schema'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import { assertWithinTier, type KycTier } from '@/lib/kyc/tier-caps'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { LocalFileAdapter } from '@/lib/storage/local'

// ── Validation schema ────────────────────────────────────────────

export const updateExperienceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required').max(200),
  shortDescription: z.string().max(500).nullable().optional(),
  longDescription: z.string().max(5000).nullable().optional(),
  activitySlug: z.string().min(1, 'Activity is required'),
  regionSlug: z.string().min(1, 'Region is required'),
  pricePerPerson_1_2: z.number().positive('Price must be positive'),
  pricePerPerson_3_5: z.number().positive('Price must be positive'),
  pricePerPerson_6_plus: z.number().positive('Price must be positive'),
  cancellationPreset: z.enum(['flexible', 'moderate', 'strict', 'custom']),
  paymentModesAllowed: z
    .array(z.enum(['full_upfront', 'partial_pay', 'reserve_now_pay_later']))
    .min(1, 'At least one payment mode is required'),
  isCombo: z.boolean(),
  requiredPermits: z.array(z.string()),
  requiresSafetyStack: z.boolean(),
})

export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>

type UpdateExperienceResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

// ── Core testable function ───────────────────────────────────────

export async function executeUpdateExperience(
  db: DBOrTx,
  userId: string,
  input: UpdateExperienceInput,
): Promise<UpdateExperienceResult> {
  const parsed = updateExperienceSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      if (!fieldErrors[key]) fieldErrors[key] = []
      fieldErrors[key].push(issue.message)
    }
    return { ok: false, error: 'Validation failed.', fieldErrors }
  }

  const data = parsed.data

  // Verify ownership — vendor can only edit their own Experiences.
  const [existing] = await db
    .select({
      id: experiences.id,
      vendorUserId: experiences.vendorUserId,
      status: experiences.status,
      kycTier: vendorProfiles.kycTier,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(eq(experiences.id, data.id))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Experience not found.' }
  }
  if (existing.vendorUserId !== userId) {
    return { ok: false, error: 'You do not own this experience.' }
  }

  // ADR-0007 — enforce the Vendor's KYC-tier caps when editing a LIVE
  // listing (published / pending_review / paused). Editing a draft is
  // unrestricted. The check runs against the PROPOSED price/combo (this
  // edit's input) combined with the Experience's existing slots, so a
  // Vendor cannot escalate a live listing past their tier via the form.
  if (existing.status !== 'draft' && existing.status !== 'archived') {
    const slots = await db
      .select({
        startAt: availabilitySlots.startAt,
        endAt: availabilitySlots.endAt,
        capacity: availabilitySlots.capacity,
      })
      .from(availabilitySlots)
      .where(eq(availabilitySlots.experienceId, data.id))

    const tierCheck = assertWithinTier({
      kycTier: existing.kycTier as KycTier,
      pricePerPersonRupees: Math.max(
        data.pricePerPerson_1_2,
        data.pricePerPerson_3_5,
        data.pricePerPerson_6_plus,
      ),
      isCombo: data.isCombo,
      slots,
    })
    if (!tierCheck.ok) {
      // ADR-0007 — record the tier-cap rejection in audit_logs (the publish
      // and booking-create paths do the same) before refusing the edit.
      await writeAuditLog(db, {
        actorUserId: userId,
        action: 'vendor.experience.tier_cap_rejected',
        entityType: 'experience',
        entityId: data.id,
        payload: {
          code: tierCheck.code,
          reason: tierCheck.reason,
        },
      })
      return { ok: false, error: tierCheck.reason }
    }
  }

  try {
    await db
      .update(experiences)
      .set({
        title: data.title,
        shortDescription: data.shortDescription ?? null,
        longDescription: data.longDescription ?? null,
        activitySlug: data.activitySlug,
        regionSlug: data.regionSlug,
        pricePerPerson_1_2: String(data.pricePerPerson_1_2),
        pricePerPerson_3_5: String(data.pricePerPerson_3_5),
        pricePerPerson_6_plus: String(data.pricePerPerson_6_plus),
        cancellationPreset: data.cancellationPreset,
        paymentModesAllowed: data.paymentModesAllowed,
        isCombo: data.isCombo,
        requiredPermits: data.requiredPermits,
        requiresSafetyStack: data.requiresSafetyStack,
        updatedAt: new Date(),
      })
      .where(eq(experiences.id, data.id))

    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to update: ${message}` }
  }
}

// ── Server action wrapper ────────────────────────────────────────

export async function updateExperienceAction(
  input: UpdateExperienceInput,
): Promise<UpdateExperienceResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeUpdateExperience(prodDb, session.user.id, input)
}

// ── Image upload action ──────────────────────────────────────────

type UploadImageResult =
  | { ok: true; asset: { id: string; url: string; storageKey: string } }
  | { ok: false; error: string }

export async function uploadExperienceImageAction(
  formData: FormData,
): Promise<UploadImageResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  const file = formData.get('file') as File | null
  const experienceId = formData.get('experienceId') as string | null

  if (!file || !experienceId) {
    return { ok: false, error: 'File and experience ID are required.' }
  }

  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Only image files are allowed.' }
  }

  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'File size must be under 10 MB.' }
  }

  // Verify ownership
  const [existing] = await prodDb
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!existing || existing.vendorUserId !== session.user.id) {
    return { ok: false, error: 'Experience not found or not owned by you.' }
  }

  const adapter = new LocalFileAdapter()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const key = `experiences/${experienceId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  try {
    const { url, storageKey } = await adapter.upload(file, key)

    const [asset] = await prodDb
      .insert(mediaAssets)
      .values({
        uploadedBy: session.user.id,
        storageKey,
        url,
        contentType: file.type,
        sizeBytes: file.size,
        entityType: 'experience',
        entityId: experienceId,
      })
      .returning({ id: mediaAssets.id, url: mediaAssets.url, storageKey: mediaAssets.storageKey })

    return { ok: true, asset }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Upload failed: ${message}` }
  }
}

// ── Delete image action ──────────────────────────────────────────

type DeleteImageResult = { ok: true } | { ok: false; error: string }

export async function deleteExperienceImageAction(
  assetId: string,
): Promise<DeleteImageResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  const [asset] = await prodDb
    .select({
      id: mediaAssets.id,
      storageKey: mediaAssets.storageKey,
      uploadedBy: mediaAssets.uploadedBy,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, assetId))
    .limit(1)

  if (!asset) {
    return { ok: false, error: 'Image not found.' }
  }
  if (asset.uploadedBy !== session.user.id) {
    return { ok: false, error: 'Not authorized to delete this image.' }
  }

  const adapter = new LocalFileAdapter()

  try {
    await adapter.delete(asset.storageKey)
    await prodDb.delete(mediaAssets).where(eq(mediaAssets.id, assetId))
    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Delete failed: ${message}` }
  }
}
