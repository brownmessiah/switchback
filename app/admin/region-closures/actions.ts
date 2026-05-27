'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  executeCreateClosure,
  executeDeleteClosure,
  type ClosureActionResult,
} from '@/lib/admin/region-closure-actions'

export async function createClosureAction(
  regionSlug: string,
  startAt: string,
  endAt: string,
  reason: string,
): Promise<ClosureActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeCreateClosure(prodDb, session.user.id, {
    regionSlug,
    startAt,
    endAt,
    reason,
  })

  if (result.ok) revalidatePath('/admin/region-closures')
  return result
}

export async function deleteClosureAction(
  closureId: string,
): Promise<ClosureActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeDeleteClosure(prodDb, session.user.id, closureId)

  if (result.ok) revalidatePath('/admin/region-closures')
  return result
}
