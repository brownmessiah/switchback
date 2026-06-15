import { and, count, eq, inArray, ne } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { CLOSE_CONFIRM_PHRASE } from './close-account-constants'

/**
 * Vendor account-closure CORE (issue 06).
 *
 * These db-injected functions are deliberately NOT in the `'use server'`
 * module. In this Next.js, every exported async function from a `'use server'`
 * file is registered as a client-callable Server Action endpoint reachable via
 * a direct POST — see node_modules/next/dist/docs/01-app/02-guides/data-security.md.
 * Exporting `getVendorClosureEligibility(db, vendorUserId)` /
 * `executeCloseVendorAccount(db, vendorUserId, ...)` from there would create
 * auth-bypassing endpoints that take an arbitrary, client-supplied
 * `vendorUserId` (IDOR) on a money/role path. Keeping them in this plain
 * (non-`'use server'`) module — imported only by the `'use server'` wrapper and
 * the server-rendered Settings page — means the ONLY public entry point is the
 * thin session-deriving wrapper in close-account-actions.ts.
 */

// ── Domain constants (issue 06 contract) ────────────────────────────

/**
 * Non-terminal Booking states (ADR-0003). A Vendor with ANY in-flight
 * Booking cannot close — guests still hold live Bookings against their
 * Experiences. Terminal states (completed, cancelled_*, no_show) are
 * excluded.
 */
const IN_FLIGHT_STATES = [
  'pending_payment',
  'confirmed',
  'awaiting_completion',
  'disputed',
] as const

/**
 * Payout states that mean money is still owed to the Vendor (ADR-0016).
 * 'rejected' = nothing owed; there is no 'paid'/'disbursed' state in v1
 * (disbursement is M3). Only meaningful on COMPLETED Bookings — payoutState
 * defaults to 'pending' on every Booking regardless of state, so the
 * state='completed' filter on the dues query is ESSENTIAL.
 */
const UNSETTLED_PAYOUT_STATES = ['pending', 'approved', 'held'] as const

/**
 * Retention basis recorded in the audit payload. ADR-0016 mandates we keep
 * financial/tax records for years — this is WHY closure is a soft-archive,
 * never a delete.
 */
const RETENTION_BASIS =
  'IT 6-8yr / CGST §36 72mo / Companies Act 8yr / DPDP §12(3) compliance-with-law'

// ── Result types ────────────────────────────────────────────────────

export interface VendorClosureEligibility {
  canClose: boolean
  inFlightCount: number
  unsettledDuesCount: number
}

export type CloseVendorAccountResult =
  | { ok: true }
  | { ok: false; error: string }

export interface CloseVendorAccountInput {
  confirmPhrase: string
  reason: string | null
}

// ── Archive count (testable helper; lines up with the archive query) ─

/**
 * Count the Vendor's Experiences that a closure WILL archive — i.e. every
 * Experience whose status is not already 'archived'. This MUST match the
 * `ne(experiences.status, 'archived')` filter on the archive UPDATE inside
 * {@link executeCloseVendorAccount} so the dialog's "{count} Experiences will
 * be archived" copy and the audit payload's `experiencesArchivedCount` agree.
 * Counting ALL Experiences (including draft/paused/already-archived) would
 * overstate what actually changes.
 */
export async function getArchivableExperienceCount(
  db: DBOrTx,
  vendorUserId: string,
): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(experiences)
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        ne(experiences.status, 'archived'),
      ),
    )
  return value
}

// ── Eligibility (server-computed; never trusted from the client) ─────

/**
 * Compute closure eligibility from real Bookings/Payout state. Used both to
 * server-render the blocked checklist on the Settings page and as the gate
 * inside {@link executeCloseVendorAccount}.
 *
 * Both queries scope to the Vendor via experiences.vendorUserId.
 */
export async function getVendorClosureEligibility(
  db: DBOrTx,
  vendorUserId: string,
): Promise<VendorClosureEligibility> {
  // Gate 1 — in-flight (non-terminal) Bookings.
  const [{ value: inFlightCount }] = await db
    .select({ value: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        inArray(bookings.state, [...IN_FLIGHT_STATES]),
      ),
    )

  // Gate 2 — unsettled Payout dues on COMPLETED Bookings only.
  const [{ value: unsettledDuesCount }] = await db
    .select({ value: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(bookings.state, 'completed'),
        inArray(bookings.payoutState, [...UNSETTLED_PAYOUT_STATES]),
      ),
    )

  return {
    inFlightCount,
    unsettledDuesCount,
    canClose: inFlightCount === 0 && unsettledDuesCount === 0,
  }
}

// ── Core (auth-free, db-injected, unit-testable) ────────────────────

/**
 * Close the Vendor account: a transactional, idempotent, soft-archive.
 *
 * No money moves. Order:
 *   1. reload row + idempotent already-closed bail (no-op success)
 *   2. validate the typed phrase server-side (never trust the client)
 *   3. in-flight gate
 *   4. unsettled-dues gate
 *   5. db.transaction: archive Experiences; set closed_at + reason; audit row
 *
 * Reverting Vendor→Customer is mechanical: a closed vendor_profiles row
 * (closedAt set) falls through requireVendorProfile to /vendor/onboarding,
 * which neutralizes the Vendor role WITHOUT deleting anything (ADR-0006).
 */
export async function executeCloseVendorAccount(
  db: DBOrTx,
  vendorUserId: string,
  input: CloseVendorAccountInput,
): Promise<CloseVendorAccountResult> {
  // 1. Reload the row + idempotent already-closed bail.
  const [vendor] = await db
    .select({ userId: vendorProfiles.userId, closedAt: vendorProfiles.closedAt })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'No Vendor account found.' }
  }

  if (vendor.closedAt) {
    // Already closed — a clean no-op success (no second audit row).
    return { ok: true }
  }

  // 2. Validate the typed phrase server-side.
  if (input.confirmPhrase !== CLOSE_CONFIRM_PHRASE) {
    return { ok: false, error: 'Type CLOSE to confirm.' }
  }

  // 3 + 4. Eligibility gates (computed from real Booking/Payout state).
  const eligibility = await getVendorClosureEligibility(db, vendorUserId)
  if (eligibility.inFlightCount > 0) {
    return { ok: false, error: 'You have in-flight Bookings. Complete or cancel them first.' }
  }
  if (eligibility.unsettledDuesCount > 0) {
    return { ok: false, error: 'You have Bookings with Payouts still to settle.' }
  }

  const closureReason = input.reason?.trim() || null
  const closedAt = new Date()

  // 5. Atomic close: archive Experiences, mark closed, write audit.
  await db.transaction(async (tx) => {
    const archived = await tx
      .update(experiences)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(eq(experiences.vendorUserId, vendorUserId), ne(experiences.status, 'archived')),
      )
      .returning({ id: experiences.id })

    await tx
      .update(vendorProfiles)
      .set({ closedAt, closureReason, updatedAt: new Date() })
      .where(eq(vendorProfiles.userId, vendorUserId))

    await writeAuditLog(tx, {
      actorUserId: vendorUserId,
      action: 'vendor.profile.closed',
      entityType: 'vendor_profile',
      entityId: vendorUserId,
      payload: {
        closureReason,
        closedAt: closedAt.toISOString(),
        experiencesArchivedCount: archived.length,
        inFlightCountAtClosure: 0,
        unsettledDuesCountAtClosure: 0,
        retentionBasis: RETENTION_BASIS,
        reverted: 'vendor_to_customer',
      },
    })
  })

  return { ok: true }
}
