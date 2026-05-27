import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  availabilityPatterns,
  type AvailabilityPattern,
} from '@/db/schema/availability-patterns'
import { experiences } from '@/db/schema/experiences'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Validation schemas ────────────────────────────────────────────

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export const createPatternSchema = z.object({
  experienceId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(timePattern, 'Must be HH:mm format (00:00–23:59)'),
  endTime: z.string().regex(timePattern, 'Must be HH:mm format (00:00–23:59)'),
  capacity: z.number().int().positive('Capacity must be positive'),
  effectiveFrom: z.string().date().nullable().optional(),
  effectiveUntil: z.string().date().nullable().optional(),
})

export type CreatePatternInput = z.infer<typeof createPatternSchema>

export const updatePatternSchema = z.object({
  id: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(timePattern, 'Must be HH:mm format').optional(),
  endTime: z.string().regex(timePattern, 'Must be HH:mm format').optional(),
  capacity: z.number().int().positive().optional(),
  effectiveFrom: z.string().date().nullable().optional(),
  effectiveUntil: z.string().date().nullable().optional(),
})

export type UpdatePatternInput = z.infer<typeof updatePatternSchema>

type PatternResult =
  | { ok: true; pattern: AvailabilityPattern }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

type DeleteResult = { ok: true } | { ok: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────

function extractFieldErrors(issues: z.ZodIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join('.')
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

async function verifyOwnership(
  db: DBOrTx,
  experienceId: string,
  userId: string,
): Promise<string | null> {
  const [exp] = await db
    .select({ id: experiences.id, vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) return 'Experience not found.'
  if (exp.vendorUserId !== userId) return 'You do not own this experience.'
  return null
}

// ── Create ────────────────────────────────────────────────────────

export async function executeCreatePattern(
  db: DBOrTx,
  userId: string,
  input: CreatePatternInput,
): Promise<PatternResult> {
  const parsed = createPatternSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Validation failed.',
      fieldErrors: extractFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data
  const ownershipError = await verifyOwnership(db, data.experienceId, userId)
  if (ownershipError) return { ok: false, error: ownershipError }

  const [pattern] = await db
    .insert(availabilityPatterns)
    .values({
      experienceId: data.experienceId,
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      capacity: data.capacity,
      effectiveFrom: data.effectiveFrom ?? null,
      effectiveUntil: data.effectiveUntil ?? null,
    })
    .returning()

  return { ok: true, pattern }
}

// ── Update ────────────────────────────────────────────────────────

export async function executeUpdatePattern(
  db: DBOrTx,
  userId: string,
  input: UpdatePatternInput,
): Promise<PatternResult> {
  const parsed = updatePatternSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Validation failed.',
      fieldErrors: extractFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data

  // Fetch existing pattern and verify ownership via its experience
  const [existing] = await db
    .select()
    .from(availabilityPatterns)
    .where(eq(availabilityPatterns.id, data.id))
    .limit(1)

  if (!existing) return { ok: false, error: 'Pattern not found.' }

  const ownershipError = await verifyOwnership(db, existing.experienceId, userId)
  if (ownershipError) return { ok: false, error: ownershipError }

  const setFields: Record<string, unknown> = { updatedAt: new Date() }
  if (data.dayOfWeek !== undefined) setFields.dayOfWeek = data.dayOfWeek
  if (data.startTime !== undefined) setFields.startTime = data.startTime
  if (data.endTime !== undefined) setFields.endTime = data.endTime
  if (data.capacity !== undefined) setFields.capacity = data.capacity
  if (data.effectiveFrom !== undefined) setFields.effectiveFrom = data.effectiveFrom
  if (data.effectiveUntil !== undefined) setFields.effectiveUntil = data.effectiveUntil

  const [updated] = await db
    .update(availabilityPatterns)
    .set(setFields)
    .where(eq(availabilityPatterns.id, data.id))
    .returning()

  return { ok: true, pattern: updated }
}

// ── Delete ────────────────────────────────────────────────────────

export async function executeDeletePattern(
  db: DBOrTx,
  userId: string,
  patternId: string,
): Promise<DeleteResult> {
  const [existing] = await db
    .select({ id: availabilityPatterns.id, experienceId: availabilityPatterns.experienceId })
    .from(availabilityPatterns)
    .where(eq(availabilityPatterns.id, patternId))
    .limit(1)

  if (!existing) return { ok: false, error: 'Pattern not found.' }

  const ownershipError = await verifyOwnership(db, existing.experienceId, userId)
  if (ownershipError) return { ok: false, error: ownershipError }

  await db
    .delete(availabilityPatterns)
    .where(eq(availabilityPatterns.id, patternId))

  return { ok: true }
}

// ── List patterns for an experience ───────────────────────────────

export async function listPatterns(
  db: DBOrTx,
  experienceId: string,
): Promise<AvailabilityPattern[]> {
  return db
    .select()
    .from(availabilityPatterns)
    .where(eq(availabilityPatterns.experienceId, experienceId))
}
