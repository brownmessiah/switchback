'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  executeResolveAsCompleted,
  executeResolveAsCancelledPostExperience,
  type DisputeActionResult,
} from '@/lib/bookings/admin-dispute-actions'

// ── Server action: resolve as completed ────────────────────────────

export async function resolveAsCompletedAction(
  bookingId: string,
  notes: string,
  partialRefundRupees?: number,
  adjustedCommissionRate?: string,
): Promise<DisputeActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeResolveAsCompleted(prodDb, {
    adminUserId: session.user.id,
    bookingId,
    notes,
    partialRefundRupees,
    adjustedCommissionRate,
  })

  if (result.ok) {
    revalidatePath('/admin/disputes')
    revalidatePath('/admin/bookings')
  }
  return result
}

// ── Server action: resolve as cancelled post-experience ────────────

export async function resolveAsCancelledAction(
  bookingId: string,
  notes: string,
): Promise<DisputeActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeResolveAsCancelledPostExperience(prodDb, {
    adminUserId: session.user.id,
    bookingId,
    notes,
  })

  if (result.ok) {
    revalidatePath('/admin/disputes')
    revalidatePath('/admin/bookings')
  }
  return result
}
