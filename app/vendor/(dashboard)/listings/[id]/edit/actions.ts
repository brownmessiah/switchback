'use server'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

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
 * Server Action wrappers (auth layer). Each resolves the acting Vendor context
 * and gates `experiences:manage` against the RESOLVED shop (issue #11) before
 * delegating to the db-injected core in ./update-core (issue #03). The cores'
 * `userId` (ownership) arg is the SHOP; the `actingUserId` arg is the human
 * (audit / `uploadedBy`, §5). The cores are NOT exported from this `'use server'`
 * file (IDOR avoidance).
 *
 * Permission: editing an Experience and managing its images is
 * `experiences:manage`.
 */

const DENIED = 'You do not have permission to manage experiences.'

export async function updateExperienceAction(
  input: UpdateExperienceInput,
): Promise<UpdateExperienceResult> {
  const gate = await requireVendorActionContext('experiences:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  return executeUpdateExperience(prodDb, gate.shop, input, gate.acting)
}

export async function uploadExperienceImageAction(
  formData: FormData,
): Promise<UploadImageResult> {
  const gate = await requireVendorActionContext('experiences:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  const file = formData.get('file') as File | null
  const experienceId = formData.get('experienceId') as string | null

  if (!file || !experienceId) {
    return { ok: false, error: 'File and experience ID are required.' }
  }

  return executeUploadExperienceImage(
    prodDb,
    gate.shop,
    { file, experienceId },
    gate.acting,
  )
}

export async function deleteExperienceImageAction(
  assetId: string,
): Promise<DeleteImageResult> {
  const gate = await requireVendorActionContext('experiences:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  // The core keys ownership on the parent Experience's shop (#18 mandatory fix).
  return executeDeleteExperienceImage(prodDb, gate.shop, assetId)
}
