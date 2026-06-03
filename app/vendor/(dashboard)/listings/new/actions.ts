'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { experiences } from '@/db/schema'
import { auth } from '@/lib/auth'
import { replaceItinerary } from '@/lib/experiences/itinerary'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// A `'use server'` file may export ONLY async functions. The Zod schema and
// the derived types live in ./schema so this module exports nothing else.
import { createExperienceSchema, type CreateExperienceInput } from './schema'

// Re-export the type (type-only, erased at build) so the page + tests share a
// single import surface. The schema VALUE stays in ./schema.
export type { CreateExperienceInput } from './schema'

type CreateExperienceResult =
  | { ok: true; experienceId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80) +
    '-' +
    Date.now().toString(36)
  )
}

// ── Core testable function ───────────────────────────────────────
//
// Mirrors the edit action's `executeUpdateExperience`: a db-injected core so
// the create DB logic (draft insert + ADR-0017 structured facets + itinerary)
// is PGlite-integration-testable without the auth/session shell.

export async function executeCreateExperience(
  db: DBOrTx,
  userId: string,
  input: CreateExperienceInput,
): Promise<CreateExperienceResult> {
  const parsed = createExperienceSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      if (!fieldErrors[key]) fieldErrors[key] = []
      fieldErrors[key].push(issue.message)
    }
    return { ok: false, error: 'Validation failed.', fieldErrors }
  }

  const data = parsed.data
  const slug = slugify(data.title)

  // The 3-5 / 6+ brackets default to the 1-2 price when the Vendor leaves
  // them blank (flat-priced listings — ADR-0011).
  const price12 = data.pricePerPerson_1_2
  const price35 = data.pricePerPerson_3_5 ?? price12
  const price6 = data.pricePerPerson_6_plus ?? price35

  try {
    // ADR-0017 — the draft row + its (optional) itinerary commit atomically.
    const experienceId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(experiences)
        .values({
          vendorUserId: userId,
          slug,
          title: data.title,
          shortDescription: data.shortDescription ?? null,
          activitySlug: data.activitySlug,
          regionSlug: data.regionSlug,
          pricePerPerson_1_2: String(price12),
          pricePerPerson_3_5: String(price35),
          pricePerPerson_6_plus: String(price6),
          cancellationPreset: data.cancellationPreset,
          paymentModesAllowed: ['full_upfront', 'partial_pay'],
          status: 'draft',
          // ADR-0017 structured attributes — persisted when the form sends
          // them; otherwise the column defaults (null / empty array) hold.
          difficulty: data.difficulty ?? null,
          durationMinutes: data.durationMinutes ?? null,
          minAge: data.minAge ?? null,
          maxGroupSize: data.maxGroupSize ?? null,
          languages: data.languages ?? [],
          meetingPoint: data.meetingPoint ?? null,
          seasonMonths: data.seasonMonths ?? [],
          highlights: data.highlights ?? [],
          inclusions: data.inclusions ?? [],
          exclusions: data.exclusions ?? [],
          whatToBring: data.whatToBring ?? [],
        })
        .returning({ id: experiences.id })

      if (data.itinerary !== undefined && data.itinerary.length > 0) {
        await replaceItinerary(tx, row.id, data.itinerary)
      }

      return row.id
    })

    return { ok: true, experienceId }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('unique') || message.includes('duplicate')) {
      return { ok: false, error: 'A listing with this title already exists.' }
    }
    return { ok: false, error: 'Failed to create listing. Please try again.' }
  }
}

// ── Server action wrapper ────────────────────────────────────────

export async function createExperienceAction(
  input: CreateExperienceInput,
): Promise<CreateExperienceResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeCreateExperience(prodDb, session.user.id, input)
}
