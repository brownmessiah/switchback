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

// ── Core testable functions ─────────────────────────────────────────

export async function executeApproveExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string },
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

  if (!(APPROVE_FROM as readonly string[]).includes(exp.status)) {
    return {
      ok: false,
      error: `Cannot approve: experience must be in pending_review status (current: ${exp.status}).`,
    }
  }

  // The Vendor's application decision gates going live (ADR-0007 amended).
  // Publishing here for a Vendor nobody has accepted — or one who was
  // rejected — would put an unvetted operator on the public site through the
  // side door, bypassing the accept/reject workflow entirely.
  const [vendor] = await db
    .select({ applicationStatus: vendorProfiles.applicationStatus })
    .from(vendorProfiles)
    .innerJoin(experiences, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (vendor?.applicationStatus !== 'approved') {
    return {
      ok: false,
      error: `Cannot publish: this Vendor's application is ${vendor?.applicationStatus ?? 'missing'}. Approve the Vendor before publishing their listings.`,
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

  await db
    .update(experiences)
    .set({ status: 'published', updatedAt: new Date() })
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

  // ADR-0019 — published is the canonical, searchable state. Postgres-native
  // search reads live from the experiences table (status='published' gate), so
  // there is no separate index to write here.
  return { ok: true }
}

export async function executeRejectExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string; reason: string },
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

  return { ok: true }
}

export async function executePauseExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string },
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

  return { ok: true }
}

export async function executeArchiveExperience(
  db: DBOrTx,
  adminUserId: string,
  input: { experienceId: string },
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
