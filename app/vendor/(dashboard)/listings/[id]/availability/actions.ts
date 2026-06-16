'use server'

import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { regionClosures } from '@/db/schema/region-closures'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { hasVendorAccess, resolveActingVendorScope } from '@/lib/auth/permissions'
import { bracketLabel, computeBalanceDueRupees } from '@/lib/availability/manifest-helpers'
import { executeBlockDate, executeUnblockDate } from '@/lib/availability/date-blocking'
import {
  executeCreatePattern,
  executeDeletePattern,
  executeUpdatePattern,
  type CreatePatternInput,
  type UpdatePatternInput,
} from '@/lib/availability/pattern-crud'
import { executeMaterializeSlots } from '@/lib/availability/materialize-core'

// ── Auth helper ─────────────────────────────────────────────────

async function requireAuth(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

/**
 * Permission gate for the availability WRITE actions (issue #03 / #11). Resolves
 * the acting user's Vendor SHOP + role (single-account model, issue #11) and
 * authorizes `availability:manage`. Returns `{ actingUserId, vendorUserId, role }`
 * when authorized, or an error envelope when not.
 *
 * The cores (`executeCreatePattern` etc.) verify the passed userId owns the
 * Experience, so they must receive the SHOP (`vendorUserId`), NOT the acting
 * member's own id — a member manages availability on the account they belong to.
 */
async function requireAvailabilityManage(): Promise<
  { actingUserId: string; vendorUserId: string; role: string } | { error: string }
> {
  const actingUserId = await requireAuth()
  if (!actingUserId) return { error: 'Sign in to continue.' }
  const scope = await resolveActingVendorScope(prodDb, actingUserId)
  if (!scope) {
    return { error: 'You do not have permission to manage availability.' }
  }
  if (!(await hasVendorAccess(prodDb, actingUserId, 'availability:manage', scope.vendorUserId))) {
    return { error: 'You do not have permission to manage availability.' }
  }
  return { actingUserId, vendorUserId: scope.vendorUserId, role: scope.role }
}

// ── Pattern actions ─────────────────────────────────────────────

export async function createPatternAction(input: CreatePatternInput) {
  const gate = await requireAvailabilityManage()
  if ('error' in gate) return { ok: false as const, error: gate.error }
  return executeCreatePattern(prodDb, gate.vendorUserId, input)
}

export async function updatePatternAction(input: UpdatePatternInput) {
  const gate = await requireAvailabilityManage()
  if ('error' in gate) return { ok: false as const, error: gate.error }
  return executeUpdatePattern(prodDb, gate.vendorUserId, input)
}

export async function deletePatternAction(patternId: string) {
  const gate = await requireAvailabilityManage()
  if ('error' in gate) return { ok: false as const, error: gate.error }
  return executeDeletePattern(prodDb, gate.vendorUserId, patternId)
}

// ── Materializer action ─────────────────────────────────────────

export async function materializeSlotsAction(experienceId: string) {
  const gate = await requireAvailabilityManage()
  if ('error' in gate) return { ok: false as const, error: gate.error }
  // Ownership pre-check lives in the core: it verifies the GATE-RESOLVED SHOP
  // owns `experienceId` before materializing — never the client input alone
  // (issue #03 review, FIX 3 — closes the cross-vendor write bypass). Mirrors
  // blockDateAction/unblockDateAction, which pass the gated shop to a lib that
  // verifies ownership.
  return executeMaterializeSlots(prodDb, gate.vendorUserId, experienceId)
}

// ── Date blocking actions ───────────────────────────────────────

export async function blockDateAction(experienceId: string, date: string) {
  const gate = await requireAvailabilityManage()
  if ('error' in gate) return { ok: false as const, error: gate.error }
  return executeBlockDate(prodDb, gate.vendorUserId, experienceId, date)
}

export async function unblockDateAction(experienceId: string, date: string) {
  const gate = await requireAvailabilityManage()
  if ('error' in gate) return { ok: false as const, error: gate.error }
  return executeUnblockDate(prodDb, gate.vendorUserId, experienceId, date)
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

/**
 * Read-only roster aggregation for the Manifest view (#78 variant A).
 *
 * Returns, per upcoming Availability slot in the month, the real Bookings on
 * that slot: who is coming, their Group-size bracket + participant count, and
 * — for Partial-pay Bookings — the balance still due (the 75% remainder
 * auto-captured at T-24h, ADR-0001). This is a pure READ aggregation joined
 * from live Bookings; it touches NO money-write path. Ownership is enforced —
 * a Vendor only sees the manifest for an Experience they own. Cancelled
 * Bookings are excluded (only live seats appear on the manifest).
 *
 * No fabrication: a field absent from the data (e.g. an unnamed Customer) is
 * returned as null and omitted in the UI rather than invented.
 */
export async function loadSlotManifest(experienceId: string, year: number, month: number) {
  const actingUserId = await requireAuth()
  if (!actingUserId) return []

  // Resolve the acting shop (issue #11): the roster is scoped to the shop's
  // Experiences. A member reads the manifest for the account they belong to.
  const scope = await resolveActingVendorScope(prodDb, actingUserId)
  if (!scope) return []
  const shop = scope.vendorUserId

  // Permission gate (issue #03) — the roster is a bookings read; a member must
  // hold `bookings:read` on the RESOLVED shop (Owner/Manager/Booking-Staff/
  // Guide/Accountant all do) to see who is coming.
  if (!(await hasVendorAccess(prodDb, actingUserId, 'bookings:read', shop))) return []

  // Ownership gate — the Experience must belong to the acting shop.
  const [exp] = await prodDb
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)
  if (!exp || exp.vendorUserId !== shop) return []

  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))

  // Live (non-cancelled) Bookings only — a cancelled seat is not on the manifest.
  const liveStates = [
    'confirmed',
    'awaiting_completion',
    'completed',
    'disputed',
  ] as const

  const rows = await prodDb
    .select({
      bookingId: bookings.id,
      slotId: bookings.slotId,
      slotStartAt: availabilitySlots.startAt,
      slotEndAt: availabilitySlots.endAt,
      slotCapacity: availabilitySlots.capacity,
      slotCapacityTaken: availabilitySlots.capacityTaken,
      participantCount: bookings.participantCount,
      state: bookings.state,
      paymentMode: bookings.paymentMode,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      customerName: users.name,
    })
    .from(bookings)
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .where(
      and(
        eq(bookings.experienceId, experienceId),
        gte(availabilitySlots.startAt, start),
        lte(availabilitySlots.startAt, end),
        inArray(bookings.state, liveStates),
      ),
    )
    .orderBy(asc(availabilitySlots.startAt), asc(bookings.confirmedAt))

  return rows.map((r) => {
    const grossRupees = Math.floor(Number(r.grossTotalSnapshot))
    return {
      bookingId: r.bookingId,
      slotId: r.slotId,
      slotStartAt: r.slotStartAt,
      slotEndAt: r.slotEndAt,
      slotCapacity: r.slotCapacity,
      slotCapacityTaken: r.slotCapacityTaken,
      participantCount: r.participantCount,
      bracket: bracketLabel(r.participantCount),
      state: r.state,
      paymentMode: r.paymentMode,
      // Balance is only owed on a Partial-pay Booking; full_upfront owes nothing.
      balanceDueRupees:
        r.paymentMode === 'partial_pay' ? computeBalanceDueRupees(grossRupees) : 0,
      customerName: r.customerName,
    }
  })
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
