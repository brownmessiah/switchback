'use server'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

import { executeCreateExperience } from './create-core'
import type { CreateExperienceInput, CreateExperienceResult } from './create-core'

/**
 * Server Action wrapper (auth layer). Resolves the acting Vendor context and
 * gates `experiences:manage` against the RESOLVED shop (issue #11) before
 * delegating to the db-injected core in ./create-core (issue #03). The new
 * Experience's `vendorUserId` is the SHOP — a member creates listings owned by
 * the account they belong to, NOT their own id.
 *
 * Permission: creating an Experience is `experiences:manage`.
 */
export async function createExperienceAction(
  input: CreateExperienceInput,
): Promise<CreateExperienceResult> {
  const gate = await requireVendorActionContext(
    'experiences:manage',
    'You do not have permission to manage experiences.',
  )
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  return executeCreateExperience(prodDb, gate.shop, input)
}
