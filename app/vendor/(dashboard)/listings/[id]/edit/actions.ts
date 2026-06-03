'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { experiences, mediaAssets } from '@/db/schema'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import { replaceItinerary } from '@/lib/experiences/itinerary'
import { assertWithinTier, type KycTier } from '@/lib/kyc/tier-caps'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { indexExperience, type ExperienceSearchDoc } from '@/lib/search/indexer'
import { LocalFileAdapter } from '@/lib/storage/local'

// A `'use server'` file may export ONLY async functions. The Zod schema and
// the derived types live in ./schema so this module exports nothing else.
import {
  updateExperienceSchema,
  type UpdateExperienceInput,
  type UpdateExperienceOpts,
} from './schema'

// Re-export the types (type-only, erased at build) so existing importers and
// the form keep a single import surface. The schema VALUE stays in ./schema.
export type { UpdateExperienceInput, UpdateExperienceOpts } from './schema'

type UpdateExperienceResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

// ── Core testable function ───────────────────────────────────────

export async function executeUpdateExperience(
  db: DBOrTx,
  userId: string,
  input: UpdateExperienceInput,
  opts: UpdateExperienceOpts = {},
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
      slug: experiences.slug,
      kycTier: vendorProfiles.kycTier,
      vendorSlug: vendorProfiles.slug,
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
    const now = new Date()

    // ADR-0017 — the experiences row and its itinerary commit atomically:
    // the scalar/array facets live on `experiences`, the steps on
    // `experience_itinerary_steps`. `replaceItinerary` (delete-then-insert)
    // requires the caller to own the transaction, so we wrap both writes here.
    await db.transaction(async (tx) => {
      await tx
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
          // ADR-0017 structured attributes — the form now owns these.
          difficulty: data.difficulty ?? null,
          durationMinutes: data.durationMinutes ?? null,
          minAge: data.minAge ?? null,
          maxGroupSize: data.maxGroupSize ?? null,
          languages: data.languages ?? [],
          meetingPoint: data.meetingPoint ?? null,
          seasonMonths: data.seasonMonths ?? [],
          highlights: data.highlights ?? [],
          inclusions: data.inclusions ?? [],
          exclusions: data.exclusions ?? [],
          whatToBring: data.whatToBring ?? [],
          updatedAt: now,
        })
        .where(eq(experiences.id, data.id))

      // Only replace the itinerary when the form sent one. Omitting it (a
      // partial edit that never opened the Itinerary step) leaves existing
      // steps untouched; sending `[]` explicitly clears them.
      if (data.itinerary !== undefined) {
        await replaceItinerary(tx, data.id, data.itinerary)
      }
    })

    // ADR-0013 — a PUBLISHED Experience is the canonical search row. Keep the
    // Meilisearch document in sync with the edited facet fields (title, price,
    // activity/region, combo, and the ADR-0017 structured facets). Drafts,
    // paused, archived, and pending_review listings are not searchable (admin
    // pause/archive deindex them), so we only re-index when the listing is
    // currently published. The headline 1-2 Group-size bracket is the "From"
    // facet price, matching the admin approve path
    // (app/admin/experiences/actions.ts). The facet fields are built from the
    // freshly-saved `data.*`, NOT the pre-edit row — the form owns them now.
    if (existing.status === 'published') {
      const searchDoc: ExperienceSearchDoc = {
        id: data.id,
        slug: existing.slug,
        title: data.title,
        shortDescription: data.shortDescription ?? null,
        activitySlug: data.activitySlug,
        regionSlug: data.regionSlug,
        vendorSlug: existing.vendorSlug,
        pricePerPersonRupees: Math.round(data.pricePerPerson_1_2),
        isCombo: data.isCombo,
        publishedAt: now,
        difficulty: data.difficulty ?? null,
        durationMinutes: data.durationMinutes ?? null,
        maxGroupSize: data.maxGroupSize ?? null,
        seasonMonths: data.seasonMonths ?? [],
      }
      await indexExperience(searchDoc, { client: opts.searchClient })
    }

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
