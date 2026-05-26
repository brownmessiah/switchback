'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { experiences } from '@/db/schema'
import { auth } from '@/lib/auth'

interface CreateExperienceInput {
  title: string
  shortDescription?: string
  activitySlug: string
  regionSlug: string
  pricePerPerson_1_2: number
  pricePerPerson_3_5: number
  pricePerPerson_6_plus: number
  cancellationPreset: 'flexible' | 'moderate' | 'strict'
}

type CreateExperienceResult =
  | { ok: true; experienceId: string }
  | { ok: false; error: string }

export async function createExperienceAction(
  input: CreateExperienceInput,
): Promise<CreateExperienceResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  if (!input.title || !input.activitySlug || !input.regionSlug) {
    return { ok: false, error: 'Title, activity, and region are required.' }
  }

  if (input.pricePerPerson_1_2 <= 0) {
    return { ok: false, error: 'Price must be positive.' }
  }

  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
    + '-' + Date.now().toString(36)

  try {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: session.user.id,
        slug,
        title: input.title,
        shortDescription: input.shortDescription || null,
        activitySlug: input.activitySlug,
        regionSlug: input.regionSlug,
        pricePerPerson_1_2: String(input.pricePerPerson_1_2),
        pricePerPerson_3_5: String(input.pricePerPerson_3_5),
        pricePerPerson_6_plus: String(input.pricePerPerson_6_plus),
        cancellationPreset: input.cancellationPreset,
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        status: 'draft',
      })
      .returning({ id: experiences.id })

    return { ok: true, experienceId: row.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('unique') || message.includes('duplicate')) {
      return { ok: false, error: 'A listing with this title already exists.' }
    }
    return { ok: false, error: 'Failed to create listing. Please try again.' }
  }
}
