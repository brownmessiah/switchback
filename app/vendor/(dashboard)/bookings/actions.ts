'use server'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

import {
  executeMarkCompleteAction,
  executeMarkNoShowAction,
  executeVendorCancelAction,
} from './action-cores'
import type {
  MarkCompleteResult,
  MarkNoShowResult,
  VendorCancelResult,
} from './action-cores'

/**
 * Server Action wrappers (auth layer) — the ONLY public entry points for
 * vendor booking management. Each resolves the acting Vendor context and gates
 * `bookings:manage` against the RESOLVED shop (issue #11) BEFORE delegating to
 * the db-injected core in ./action-cores (issue #03). The cores are NOT exported
 * from this `'use server'` file precisely so they are not registered as
 * auth-bypassing endpoints that take an arbitrary vendorUserId.
 *
 * Two-id split (§5): the core's `vendorUserId` arg is the SHOP (ownership /
 * SLA target), while `actingUserId` is the acting human (audit actor / refund
 * `requestedByUserId`), so a member's action is attributed to them but scoped
 * to the account they belong to.
 *
 * Permission: marking complete / cancelling / no-show are booking management →
 * `bookings:manage`.
 */

const DENIED = 'You do not have permission to manage bookings.'

export async function markCompleteAction(
  bookingId: string,
): Promise<MarkCompleteResult> {
  const gate = await requireVendorActionContext('bookings:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }
  return executeMarkCompleteAction(prodDb, gate.shop, { bookingId }, gate.acting)
}

export async function vendorCancelAction(
  input: { bookingId: string; reason: string },
): Promise<VendorCancelResult> {
  const gate = await requireVendorActionContext('bookings:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }
  return executeVendorCancelAction(prodDb, gate.shop, input, gate.acting)
}

export async function markNoShowAction(
  bookingId: string,
): Promise<MarkNoShowResult> {
  const gate = await requireVendorActionContext('bookings:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }
  return executeMarkNoShowAction(prodDb, gate.shop, { bookingId }, gate.acting)
}
