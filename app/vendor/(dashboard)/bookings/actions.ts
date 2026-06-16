'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasVendorAccess } from '@/lib/auth/permissions'

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
 * vendor booking management. Every exported async function here derives the
 * Vendor identity from the session and gates with `hasVendorAccess` BEFORE
 * delegating to the db-injected core in ./action-cores (issue #03). The cores
 * are NOT exported from this `'use server'` file precisely so they are not
 * registered as auth-bypassing endpoints that take an arbitrary vendorUserId.
 *
 * Permission: marking complete / cancelling / no-show are booking management →
 * `bookings:manage`.
 */

export async function markCompleteAction(
  bookingId: string,
): Promise<MarkCompleteResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'bookings:manage'))) {
    return { ok: false, error: 'You do not have permission to manage bookings.' }
  }
  return executeMarkCompleteAction(prodDb, session.user.id, { bookingId })
}

export async function vendorCancelAction(
  input: { bookingId: string; reason: string },
): Promise<VendorCancelResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'bookings:manage'))) {
    return { ok: false, error: 'You do not have permission to manage bookings.' }
  }
  return executeVendorCancelAction(prodDb, session.user.id, input)
}

export async function markNoShowAction(
  bookingId: string,
): Promise<MarkNoShowResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'bookings:manage'))) {
    return { ok: false, error: 'You do not have permission to manage bookings.' }
  }
  return executeMarkNoShowAction(prodDb, session.user.id, { bookingId })
}
