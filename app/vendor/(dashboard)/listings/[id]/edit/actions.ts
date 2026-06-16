'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasVendorAccess } from '@/lib/auth/permissions'

import {
  executeDeleteExperienceImage,
  executeUpdateExperience,
  executeUploadExperienceImage,
} from './update-core'
import type {
  DeleteImageResult,
  UpdateExperienceInput,
  UpdateExperienceResult,
  UploadImageResult,
} from './update-core'

/**
 * Server Action wrappers (auth layer). Each derives the Vendor identity from
 * the session and gates with `hasVendorAccess` before delegating to the
 * db-injected core in ./update-core (issue #03). The cores are NOT exported
 * from this `'use server'` file (IDOR avoidance).
 *
 * Permission: editing an Experience and managing its images is
 * `experiences:manage`.
 */

export async function updateExperienceAction(
  input: UpdateExperienceInput,
): Promise<UpdateExperienceResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'experiences:manage'))) {
    return { ok: false, error: 'You do not have permission to manage experiences.' }
  }

  return executeUpdateExperience(prodDb, session.user.id, input)
}

export async function uploadExperienceImageAction(
  formData: FormData,
): Promise<UploadImageResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'experiences:manage'))) {
    return { ok: false, error: 'You do not have permission to manage experiences.' }
  }

  const file = formData.get('file') as File | null
  const experienceId = formData.get('experienceId') as string | null

  if (!file || !experienceId) {
    return { ok: false, error: 'File and experience ID are required.' }
  }

  return executeUploadExperienceImage(prodDb, session.user.id, { file, experienceId })
}

export async function deleteExperienceImageAction(
  assetId: string,
): Promise<DeleteImageResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'experiences:manage'))) {
    return { ok: false, error: 'You do not have permission to manage experiences.' }
  }

  return executeDeleteExperienceImage(prodDb, session.user.id, assetId)
}
