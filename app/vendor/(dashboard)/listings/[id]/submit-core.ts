import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'

import { experiences } from '@/db/schema/experiences'
import { mediaAssets } from '@/db/schema/media-assets'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { computeListingCompleteness } from '@/lib/vendor/listing-completeness'

/**
 * Submit-for-review CORE — the `draft → pending_review` transition.
 *
 * This is the step that connects the two halves of the listing lifecycle. A
 * Vendor's Experience is created as `draft`
 * (`listings/new/create-core.ts`), and the admin moderation queue only ever
 * acts on `pending_review` (`app/admin/experiences/actions.ts`). Without this
 * transition the publish pipeline is unreachable: nothing a Vendor creates
 * can ever go live.
 *
 * It is also half of the ADR-0007 Tier-2 gate ("Aadhaar OTP AND PAN validated
 * AND at least one Experience submitted for admin review"), which is why a
 * `phone`-tier Vendor is explicitly allowed to submit. Submitting is NOT
 * publishing — the tier caps stay where ADR-0007 puts them, at publish time
 * (admin approve, or the KYC-approval cascade).
 *
 * Lives in a PLAIN module, not a `'use server'` one: every exported async
 * function in a `'use server'` file is a client-callable endpoint, and a core
 * taking an arbitrary `vendorUserId` would be an IDOR. The thin action wrapper
 * derives identity from the session and delegates here.
 */

// ── Result types ────────────────────────────────────────────────────

export type SubmitForReviewResult =
  | { ok: true; status: 'pending_review' }
  | { ok: false; error: string }

// ── Validation schema ───────────────────────────────────────────────

const submitForReviewSchema = z.object({
  experienceId: z.string().uuid('Experience ID must be a valid UUID.'),
})

export type SubmitForReviewInput = z.input<typeof submitForReviewSchema>

// ── Core testable function ──────────────────────────────────────────

/**
 * Queue one of the Vendor's own draft Experiences for admin review.
 *
 * Idempotent: an Experience already in `pending_review` returns ok without a
 * second write or audit row, so a double-click never duplicates the queue
 * entry. Any other status is refused — a published listing is pulled down via
 * the admin pause/archive path, not by re-submitting it.
 */
export async function executeSubmitExperienceForReview(
  db: DBOrTx,
  vendorUserId: string,
  input: SubmitForReviewInput,
  actingUserId?: string,
): Promise<SubmitForReviewResult> {
  const parsed = submitForReviewSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { experienceId } = parsed.data

  const [existing] = await db
    .select({
      vendorUserId: experiences.vendorUserId,
      status: experiences.status,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      longDescription: experiences.longDescription,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
    })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Experience not found.' }
  }

  // Ownership guard — a Vendor may only submit their own listing.
  if (existing.vendorUserId !== vendorUserId) {
    return { ok: false, error: 'You do not own this experience.' }
  }

  // Already queued — succeed without writing again.
  if (existing.status === 'pending_review') {
    return { ok: true, status: 'pending_review' }
  }

  if (existing.status !== 'draft') {
    return {
      ok: false,
      error: `Only a draft can be submitted for review (this listing is ${existing.status}).`,
    }
  }

  const [imageCountRow] = await db
    .select({ value: count() })
    .from(mediaAssets)
    .where(
      and(eq(mediaAssets.entityType, 'experience'), eq(mediaAssets.entityId, experienceId)),
    )

  const completeness = computeListingCompleteness({
    title: existing.title,
    shortDescription: existing.shortDescription,
    longDescription: existing.longDescription,
    pricePerPerson_1_2: existing.pricePerPerson_1_2,
    pricePerPerson_3_5: existing.pricePerPerson_3_5,
    pricePerPerson_6_plus: existing.pricePerPerson_6_plus,
    activitySlug: existing.activitySlug,
    regionSlug: existing.regionSlug,
    imageCount: Number(imageCountRow?.value ?? 0),
  })

  if (completeness.percent < 100) {
    return {
      ok: false,
      error: `This listing is ${completeness.percent}% complete. Fill in the remaining details before submitting it for review: ${completeness.missing.join(', ')}.`,
    }
  }

  await db
    .update(experiences)
    .set({ status: 'pending_review', updatedAt: new Date() })
    .where(eq(experiences.id, experienceId))

  await writeAuditLog(db, {
    // Ownership is keyed on the shop; the audit trail names the human who
    // clicked (multi-seat, issue #11).
    actorUserId: actingUserId ?? vendorUserId,
    action: 'vendor.experience.submit',
    entityType: 'experience',
    entityId: experienceId,
    payload: {
      previousStatus: 'draft',
      newStatus: 'pending_review',
    },
  })

  return { ok: true, status: 'pending_review' }
}
