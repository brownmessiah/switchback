'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'

import {
  executeGrantCredit,
  manualGrantSchema,
  type GrantCreditResult,
} from './grant-logic'

export type { GrantCreditResult } from './grant-logic'

// ── Server Action wrapper (Next.js boundary) ────────────────────────

export async function adminGrantCredit(
  formData: FormData,
): Promise<GrantCreditResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'commission'))) {
    return { ok: false, error: 'You do not have permission to grant credits.' }
  }

  const raw = Object.fromEntries(formData.entries())
  const parsed = manualGrantSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const result = await executeGrantCredit(prodDb, session.user.id, parsed.data)

  if (result.ok) {
    revalidatePath('/admin/loyalty')
  }
  return result
}
