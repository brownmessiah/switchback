'use server'

import { and, eq, gte, lte } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { regionClosures } from '@/db/schema/region-closures'
import { auth } from '@/lib/auth'
import { executeBlockDate, executeUnblockDate } from '@/lib/availability/date-blocking'
import {
  executeCreatePattern,
  executeDeletePattern,
  executeUpdatePattern,
  type CreatePatternInput,
  type UpdatePatternInput,
} from '@/lib/availability/pattern-crud'
import { materializeSlots } from '@/lib/availability/slot-materializer'

// ── Auth helper ─────────────────────────────────────────────────

async function requireAuth(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

// ── Pattern actions ─────────────────────────────────────────────

export async function createPatternAction(input: CreatePatternInput) {
  const userId = await requireAuth()
  if (!userId) return { ok: false as const, error: 'Sign in to continue.' }
  return executeCreatePattern(prodDb, userId, input)
}

export async function updatePatternAction(input: UpdatePatternInput) {
  const userId = await requireAuth()
  if (!userId) return { ok: false as const, error: 'Sign in to continue.' }
  return executeUpdatePattern(prodDb, userId, input)
}

export async function deletePatternAction(patternId: string) {
  const userId = await requireAuth()
  if (!userId) return { ok: false as const, error: 'Sign in to continue.' }
  return executeDeletePattern(prodDb, userId, patternId)
}

// ── Materializer action ─────────────────────────────────────────

export async function materializeSlotsAction(experienceId: string) {
  const userId = await requireAuth()
  if (!userId) return { ok: false as const, error: 'Sign in to continue.' }
  const result = await materializeSlots(prodDb, experienceId)
  return { ok: true as const, ...result }
}

// ── Date blocking actions ───────────────────────────────────────

export async function blockDateAction(experienceId: string, date: string) {
  const userId = await requireAuth()
  if (!userId) return { ok: false as const, error: 'Sign in to continue.' }
  return executeBlockDate(prodDb, userId, experienceId, date)
}

export async function unblockDateAction(experienceId: string, date: string) {
  const userId = await requireAuth()
  if (!userId) return { ok: false as const, error: 'Sign in to continue.' }
  return executeUnblockDate(prodDb, userId, experienceId, date)
}

// ── Data loaders (for the calendar page) ────────────────────────

export async function loadSlotsForMonth(experienceId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))

  return prodDb
    .select({
      id: availabilitySlots.id,
      startAt: availabilitySlots.startAt,
      endAt: availabilitySlots.endAt,
      capacity: availabilitySlots.capacity,
      capacityTaken: availabilitySlots.capacityTaken,
      status: availabilitySlots.status,
    })
    .from(availabilitySlots)
    .where(
      and(
        eq(availabilitySlots.experienceId, experienceId),
        gte(availabilitySlots.startAt, start),
        lte(availabilitySlots.startAt, end),
      ),
    )
}

export async function loadRegionClosures(regionSlug: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))

  return prodDb
    .select({
      id: regionClosures.id,
      startAt: regionClosures.startAt,
      endAt: regionClosures.endAt,
      reason: regionClosures.reason,
      source: regionClosures.source,
    })
    .from(regionClosures)
    .where(
      and(
        eq(regionClosures.regionSlug, regionSlug),
        lte(regionClosures.startAt, end),
        gte(regionClosures.endAt, start),
      ),
    )
}
