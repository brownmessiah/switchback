'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasVendorAccess } from '@/lib/auth/permissions'

import { executeCreateExperience } from './create-core'
import type { CreateExperienceInput, CreateExperienceResult } from './create-core'

/**
 * Server Action wrapper (auth layer). Derives the Vendor identity from the
 * session and gates with `hasVendorAccess` before delegating to the
 * db-injected core in ./create-core (issue #03).
 *
 * Permission: creating an Experience is `experiences:manage`.
 */
export async function createExperienceAction(
  input: CreateExperienceInput,
): Promise<CreateExperienceResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'experiences:manage'))) {
    return { ok: false, error: 'You do not have permission to manage experiences.' }
  }

  return executeCreateExperience(prodDb, session.user.id, input)
}
