import { experiences } from '@/db/schema'
import { replaceItinerary } from '@/lib/experiences/itinerary'
import { replacePricingVariations } from '@/lib/experiences/pricing-variations-write'
import { fromPriceRupees } from '@/lib/payments/pricing-variations'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { createExperienceSchema, type CreateExperienceInput } from './schema'

// Re-export the type so the page + tests share a single import surface.
export type { CreateExperienceInput } from './schema'

/**
 * Create-Experience CORE (issue #03 security split).
 *
 * db-injected, auth-free, integration-testable. NOT in the `'use server'`
 * module (IDOR avoidance — a core taking an arbitrary `userId` would be a
 * client-callable endpoint). The thin Server Action wrapper in ./actions
 * derives identity from the session and gates with `hasVendorAccess`
 * (experiences:manage) before delegating here.
 */

export type CreateExperienceResult =
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

  // The bracket columns are NOT NULL (ADR-0011). When the Vendor priced the
  // Experience entirely via active pricing variations (issue #08) and left the
  // base blank, seed all three brackets from the lowest active variation so the
  // group-size fallback arm still has a real number — the variation remains the
  // resolved price whenever one is selected (resolvePricing arm 0).
  const variationFromPrice = Number(
    fromPriceRupees(data.pricingVariations ?? [], data.pricePerPerson_1_2 ?? 0),
  )
  const price12 = data.pricePerPerson_1_2 ?? variationFromPrice
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

      // Persist the named pricing variations (active + inactive) in the SAME
      // transaction as the draft row (issue #08). New rows only on create.
      if (data.pricingVariations !== undefined && data.pricingVariations.length > 0) {
        await replacePricingVariations(tx, row.id, data.pricingVariations)
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
