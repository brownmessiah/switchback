import { desc, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { regionClosures } from '@/db/schema/region-closures'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result type ────────────────────────────────────────────────────

export type ClosureActionResult = { ok: true; id?: string } | { ok: false; error: string }

// ── Validation schemas ─────────────────────────────────────────────

const createClosureSchema = z
  .object({
    regionSlug: z.string().trim().min(1, 'Region slug is required.'),
    startAt: z.coerce.date({ message: 'Start date is required.' }),
    endAt: z.coerce.date({ message: 'End date is required.' }),
    reason: z.string().trim().min(1, 'Reason is required.').max(2000),
  })
  .refine((d) => d.endAt > d.startAt, {
    message: 'End date must be after start date.',
    path: ['endAt'],
  })

// ── List loader ────────────────────────────────────────────────────

export async function loadRegionClosures(db: DBOrTx) {
  return db
    .select()
    .from(regionClosures)
    .orderBy(desc(regionClosures.startAt))
}

export async function loadActiveAndUpcomingClosures(db: DBOrTx) {
  const now = new Date()
  return db
    .select()
    .from(regionClosures)
    .where(gte(regionClosures.endAt, now))
    .orderBy(regionClosures.startAt)
}

// ── Create ─────────────────────────────────────────────────────────

export async function executeCreateClosure(
  db: DBOrTx,
  adminUserId: string,
  input: {
    regionSlug: string
    startAt: Date | string
    endAt: Date | string
    reason: string
  },
): Promise<ClosureActionResult> {
  const parsed = createClosureSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { regionSlug, startAt, endAt, reason } = parsed.data

  const [row] = await db
    .insert(regionClosures)
    .values({
      regionSlug,
      startAt,
      endAt,
      reason,
      source: 'admin',
    })
    .returning({ id: regionClosures.id })

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.region_closure.create',
    entityType: 'region_closure',
    entityId: row!.id,
    payload: { regionSlug, startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason },
  })

  return { ok: true, id: row!.id }
}

// ── Delete ─────────────────────────────────────────────────────────

export async function executeDeleteClosure(
  db: DBOrTx,
  adminUserId: string,
  closureId: string,
): Promise<ClosureActionResult> {
  if (!closureId) {
    return { ok: false, error: 'Closure ID is required.' }
  }

  const [existing] = await db
    .select({ id: regionClosures.id, regionSlug: regionClosures.regionSlug })
    .from(regionClosures)
    .where(eq(regionClosures.id, closureId))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Region closure not found.' }
  }

  await db.delete(regionClosures).where(eq(regionClosures.id, closureId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.region_closure.delete',
    entityType: 'region_closure',
    entityId: closureId,
    payload: { regionSlug: existing.regionSlug },
  })

  return { ok: true }
}
