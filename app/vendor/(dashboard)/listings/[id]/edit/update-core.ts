import { eq } from 'drizzle-orm'

import { experiences, mediaAssets } from '@/db/schema'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'
import { replaceItinerary } from '@/lib/experiences/itinerary'
import { replacePricingVariations } from '@/lib/experiences/pricing-variations-write'
import { fromPriceRupees } from '@/lib/payments/pricing-variations'
import { assertWithinTier, type KycTier } from '@/lib/kyc/tier-caps'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { LocalFileAdapter } from '@/lib/storage/local'

import {
  updateExperienceSchema,
  type UpdateExperienceInput,
} from './schema'

// Re-export the types so existing importers + the form keep a single import
// surface. The schema VALUE stays in ./schema.
export type { UpdateExperienceInput } from './schema'

/**
 * Edit-Experience + image CORES (issue #03 security split).
 *
 * db-injected, auth-free, integration-testable. NOT in the `'use server'`
 * module (IDOR avoidance — a core taking an arbitrary `userId` would be a
 * client-callable endpoint). The thin Server Action wrappers in ./actions
 * derive identity from the session and gate with `hasVendorAccess`
 * (experiences:manage) before delegating here.
 */

export type UpdateExperienceResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

export type UploadImageResult =
  | { ok: true; asset: { id: string; url: string; storageKey: string } }
  | { ok: false; error: string }

export type DeleteImageResult = { ok: true } | { ok: false; error: string }

// ── Update core ───────────────────────────────────────────────────────

export async function executeUpdateExperience(
  db: DBOrTx,
  userId: string,
  input: UpdateExperienceInput,
  // issue #11 §5 — the acting human (audit actor on the tier-cap-rejected path).
  // Ownership keys on `userId` (the SHOP); the audit records the human. Defaults
  // to the shop (single-seat back-compat).
  actingUserId: string = userId,
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
      // The persisted base price — the ultimate fallback when the form sends
      // neither a base price nor a variation set (issue #08).
      existingPrice12: experiences.pricePerPerson_1_2,
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

  // Resolve the three NOT-NULL bracket prices (ADR-0011). The base (1-2) price
  // is optional when active pricing variations carry the price (issue #08): in
  // that case seed the brackets from the lowest active variation so the
  // group-size fallback arm always has a real number. With neither base nor a
  // variation set, keep the existing persisted base price.
  const variationFromPrice = data.pricingVariations
    ? Number(
        fromPriceRupees(
          data.pricingVariations,
          data.pricePerPerson_1_2 ?? Number(existing.existingPrice12),
        ),
      )
    : (data.pricePerPerson_1_2 ?? Number(existing.existingPrice12))
  const price12 = data.pricePerPerson_1_2 ?? variationFromPrice
  const price35 = data.pricePerPerson_3_5 ?? price12
  const price6 = data.pricePerPerson_6_plus ?? price35

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
      pricePerPersonRupees: Math.max(price12, price35, price6),
      isCombo: data.isCombo,
      slots,
    })
    if (!tierCheck.ok) {
      // ADR-0007 — record the tier-cap rejection in audit_logs (the publish
      // and booking-create paths do the same) before refusing the edit.
      await writeAuditLog(db, {
        actorUserId: actingUserId,
        action: 'vendor.experience.tier_cap_rejected',
        entityType: 'experience',
        entityId: data.id,
        payload: {
          code: tierCheck.code,
          reason: tierCheck.reason,
          vendorUserId: userId,
          actingUserId,
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
          pricePerPerson_1_2: String(price12),
          pricePerPerson_3_5: String(price35),
          pricePerPerson_6_plus: String(price6),
          cancellationPreset: data.cancellationPreset,
          // ADR-0005 revision 2026-06-16 (issue #09) — persist the reschedule
          // right; PRD default ON when the form omits it.
          rescheduleAllowed: data.rescheduleAllowed ?? true,
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

      // Pricing variations (issue #08) — upsert ownership-scoped in the SAME
      // transaction. Omitting the field leaves existing rows untouched; sending
      // `[]` clears them. A variation id from another Experience is never
      // honoured (replacePricingVariations re-checks experienceId).
      if (data.pricingVariations !== undefined) {
        await replacePricingVariations(tx, data.id, data.pricingVariations)
      }
    })

    // ADR-0019 — a PUBLISHED Experience is the canonical search row served
    // directly by Postgres-native search (lib/search/search-experiences.ts), so
    // there is no separate index to keep in sync on edit. The status='published'
    // gate in the search query is the single source of truth.

    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to update: ${message}` }
  }
}

// ── Image upload core ──────────────────────────────────────────────────

export async function executeUploadExperienceImage(
  db: DBOrTx,
  userId: string,
  input: { file: File; experienceId: string },
  // issue #11 §5 — the acting human. Ownership keys on `userId` (the SHOP);
  // `uploadedBy` records the human who uploaded. Defaults to the shop.
  actingUserId: string = userId,
): Promise<UploadImageResult> {
  const { file, experienceId } = input

  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Only image files are allowed.' }
  }

  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'File size must be under 10 MB.' }
  }

  // Verify ownership — the Experience must belong to the acting SHOP.
  const [existing] = await db
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!existing || existing.vendorUserId !== userId) {
    return { ok: false, error: 'Experience not found or not owned by you.' }
  }

  const adapter = new LocalFileAdapter()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const key = `experiences/${experienceId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  try {
    const { url, storageKey } = await adapter.upload(file, key)

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        // §5 — record the acting human who uploaded, not the shop.
        uploadedBy: actingUserId,
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

// ── Image delete core ──────────────────────────────────────────────────

export async function executeDeleteExperienceImage(
  db: DBOrTx,
  userId: string,
  assetId: string,
): Promise<DeleteImageResult> {
  // issue #11 §5 / #18 (MANDATORY fix) — ownership keys on the PARENT
  // Experience's `vendorUserId` (= the acting SHOP, the `userId` arg), NOT on
  // `media_assets.uploadedBy`. Keying on `uploadedBy` was a real bug: a member
  // could only delete images THEY uploaded and could not delete the owner's
  // (and vice-versa). We resolve the asset, then its parent Experience, and
  // scope deletion to the shop that owns the listing. (Two queries rather than
  // a join because `media_assets.entity_id` is `text` and `experiences.id` is
  // `uuid` — the polymorphic FK has no common SQL type to join on.)
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      storageKey: mediaAssets.storageKey,
      entityType: mediaAssets.entityType,
      entityId: mediaAssets.entityId,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, assetId))
    .limit(1)

  if (!asset || asset.entityType !== 'experience') {
    return { ok: false, error: 'Image not found.' }
  }

  const [parent] = await db
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, asset.entityId))
    .limit(1)

  if (!parent || parent.vendorUserId !== userId) {
    return { ok: false, error: 'Not authorized to delete this image.' }
  }

  const adapter = new LocalFileAdapter()

  try {
    await adapter.delete(asset.storageKey)
    await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId))
    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Delete failed: ${message}` }
  }
}
