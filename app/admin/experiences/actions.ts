'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { experiences } from '@/db/schema/experiences'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
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

  const result = await executeArchiveExperience(prodDb, session.user.id, {
    experienceId,
  })

  if (result.ok) revalidatePath('/admin/experiences')
  return result
}
