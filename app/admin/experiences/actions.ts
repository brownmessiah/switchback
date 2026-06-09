'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit/write'
import { assertExperienceWithinTier } from '@/lib/kyc/enforce-tier-caps'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { indexExperience, deindexExperience, type ExperienceSearchDoc } from '@/lib/search/indexer'
import type { MeiliLike } from '@/lib/search/meilisearch-client'

// ── Result types ────────────────────────────────────────────────────

export type ExperienceModerationResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Valid transitions ───────────────────────────────────────────────

/**
 * Experience status state machine per ADR-0007 / ADR-0013:
 *   - approve: pending_review → published
 *   - reject:  pending_review → archived (requires reason)
 *   - pause:   published → paused
 *   - archive: published | paused → archived
 */
const APPROVE_FROM = ['pending_review'] as const
const REJECT_FROM = ['pending_review'] as const
const PAUSE_FROM = ['published'] as const
const ARCHIVE_FROM = ['published', 'paused'] as const

// ── Validation schemas ─────────────────────────────────────────────

const experienceIdSchema = z.object({
  experienceId: z.string().uuid('Experience ID must be a valid UUID.'),
})

const rejectSchema = z.object({
  experienceId: z.string().uuid('Experience ID must be a valid UUID.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required for rejection.')
    .max(2000),
})

// ── Search indexing options ─────────────────────────────────────────

export interface ModerationOpts {
  /** Injected Meilisearch client for testing; defaults to singleton. */
  searchClient?: MeiliLike
}

// ── Core testable functions ─────────────────────────────────────────

export async function executeApproveExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string },
  opts: ModerationOpts = {},
): Promise<ExperienceModerationResult> {
  const parsed = experienceIdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { experienceId } = parsed.data

  const [exp] = await db
    .select({
      status: experiences.status,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      vendorSlug: vendorProfiles.slug,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      isCombo: experiences.isCombo,
      // ADR-0017 structured facets (issue 04) — indexed so the /search rail
      // can filter by difficulty / duration / season / group size.
      difficulty: experiences.difficulty,
      durationMinutes: experiences.durationMinutes,
      maxGroupSize: experiences.maxGroupSize,
      seasonMonths: experiences.seasonMonths,
      // Issue 10 trust-oriented filters — indexed so the /search rail can filter
      // by safety / KYC tier / cancellation. All REAL data (D0).
      requiresSafetyStack: experiences.requiresSafetyStack,
      cancellationPreset: experiences.cancellationPreset,
      vendorKycTier: vendorProfiles.kycTier,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) {
    return { ok: false, error: 'Experience not found.' }
  }

  if (!(APPROVE_FROM as readonly string[]).includes(exp.status)) {
    return {
      ok: false,
      error: `Cannot approve: experience must be in pending_review status (current: ${exp.status}).`,
    }
  }

  // ADR-0007 — enforce the Vendor's KYC-tier caps before publishing. An
  // over-cap Experience (price, combo, multi-day, or per-slot capacity) is
  // rejected; the rejection reason is written to audit_logs and the status
  // stays pending_review.
  const tierCheck = await assertExperienceWithinTier(db, experienceId)
  if (!tierCheck.ok) {
    await writeAuditLog(db, {
      actorUserId: adminUserId,
      action: 'admin.experience.tier_cap_rejected',
      entityType: 'experience',
      entityId: experienceId,
      payload: {
        code: tierCheck.code,
        reason: tierCheck.reason,
      },
    })
    return { ok: false, error: tierCheck.reason }
  }

  const now = new Date()

  await db
    .update(experiences)
    .set({ status: 'published', updatedAt: now })
    .where(eq(experiences.id, experienceId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.experience.approve',
    entityType: 'experience',
    entityId: experienceId,
    payload: {
      previousStatus: exp.status,
      newStatus: 'published',
    },
  })

  // Index in Meilisearch so the experience appears in search results.
  const searchDoc: ExperienceSearchDoc = {
    id: experienceId,
    slug: exp.slug,
    title: exp.title,
    shortDescription: exp.shortDescription,
    activitySlug: exp.activitySlug,
    regionSlug: exp.regionSlug,
    vendorSlug: exp.vendorSlug,
    pricePerPersonRupees: Math.round(Number(exp.pricePerPerson_1_2)),
    isCombo: exp.isCombo,
    publishedAt: now,
    difficulty: exp.difficulty,
    durationMinutes: exp.durationMinutes,
    maxGroupSize: exp.maxGroupSize,
    seasonMonths: exp.seasonMonths ?? [],
    // Issue 10 trust-oriented filters. A freshly-approved Experience has no
    // published reviews yet, so ratingAvg starts at 0 (the search:reindex job
    // backfills the live aggregate); safety / KYC / cancellation are REAL data.
    ratingAvg: 0,
    requiresSafetyStack: exp.requiresSafetyStack,
    vendorKycTier: exp.vendorKycTier,
    cancellationPreset: exp.cancellationPreset,
  }
  await indexExperience(searchDoc, { client: opts.searchClient })

  return { ok: true }
}

export async function executeRejectExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string; reason: string },
  opts: ModerationOpts = {},
): Promise<ExperienceModerationResult> {
  const parsed = rejectSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { experienceId, reason } = parsed.data

  const [exp] = await db
    .select({ status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) {
    return { ok: false, error: 'Experience not found.' }
  }

  if (!(REJECT_FROM as readonly string[]).includes(exp.status)) {
    return {
      ok: false,
      error: `Cannot reject: experience must be in pending_review status (current: ${exp.status}).`,
    }
  }

  await db
    .update(experiences)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(experiences.id, experienceId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.experience.reject',
    entityType: 'experience',
    entityId: experienceId,
    payload: {
      previousStatus: exp.status,
      newStatus: 'archived',
      reason,
    },
  })

  // Deindex: rejected experiences must not appear in search.
  await deindexExperience(experienceId, { client: opts.searchClient })

  return { ok: true }
}

export async function executePauseExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string },
  opts: ModerationOpts = {},
): Promise<ExperienceModerationResult> {
  const parsed = experienceIdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { experienceId } = parsed.data

  const [exp] = await db
    .select({ status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) {
    return { ok: false, error: 'Experience not found.' }
  }

  if (!(PAUSE_FROM as readonly string[]).includes(exp.status)) {
    return {
      ok: false,
      error: `Cannot pause: experience must be published (current: ${exp.status}).`,
    }
  }

  await db
    .update(experiences)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(experiences.id, experienceId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.experience.pause',
    entityType: 'experience',
    entityId: experienceId,
    payload: {
      previousStatus: exp.status,
      newStatus: 'paused',
    },
  })

  // Deindex: paused experiences must not appear in search.
  await deindexExperience(experienceId, { client: opts.searchClient })

  return { ok: true }
}

export async function executeArchiveExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string },
  opts: ModerationOpts = {},
): Promise<ExperienceModerationResult> {
  const parsed = experienceIdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { experienceId } = parsed.data

  const [exp] = await db
    .select({ status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) {
    return { ok: false, error: 'Experience not found.' }
  }

  if (!(ARCHIVE_FROM as readonly string[]).includes(exp.status)) {
    return {
      ok: false,
      error: `Cannot archive: experience must be published or paused (current: ${exp.status}).`,
    }
  }

  await db
    .update(experiences)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(experiences.id, experienceId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.experience.archive',
    entityType: 'experience',
    entityId: experienceId,
    payload: {
      previousStatus: exp.status,
      newStatus: 'archived',
    },
  })

  // Deindex: archived experiences must not appear in search.
  await deindexExperience(experienceId, { client: opts.searchClient })

  return { ok: true }
}

// ── Server action wrappers (auth layer) ─────────────────────────────

export async function approveExperienceAction(
  experienceId: string,
): Promise<ExperienceModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'experiences'))) {
    return { ok: false, error: 'You do not have permission to moderate experiences.' }
  }

  const result = await executeApproveExperience(prodDb, session.user.id, {
    experienceId,
  })

  if (result.ok) revalidatePath('/admin/experiences')
  return result
}

export async function rejectExperienceAction(
  experienceId: string,
  reason: string,
): Promise<ExperienceModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'experiences'))) {
    return { ok: false, error: 'You do not have permission to moderate experiences.' }
  }

  const result = await executeRejectExperience(prodDb, session.user.id, {
    experienceId,
    reason,
  })

  if (result.ok) revalidatePath('/admin/experiences')
  return result
}

export async function pauseExperienceAction(
  experienceId: string,
): Promise<ExperienceModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'experiences'))) {
    return { ok: false, error: 'You do not have permission to moderate experiences.' }
  }

  const result = await executePauseExperience(prodDb, session.user.id, {
    experienceId,
  })

  if (result.ok) revalidatePath('/admin/experiences')
  return result
}

export async function archiveExperienceAction(
  experienceId: string,
): Promise<ExperienceModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'experiences'))) {
    return { ok: false, error: 'You do not have permission to moderate experiences.' }
  }

  const result = await executeArchiveExperience(prodDb, session.user.id, {
    experienceId,
  })

  if (result.ok) revalidatePath('/admin/experiences')
  return result
}
