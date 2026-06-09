/**
 * Bulk-reindex every published Experience into Meilisearch.
 *
 * Why this exists: indexing is otherwise per-Experience (admin approve /
 * vendor edit call `indexExperience`), and the seeds do NOT index. So a freshly
 * provisioned or restarted Meilisearch (the container is ephemeral) starts with
 * an EMPTY index → `/search` shows "0 experiences found" even though the DB is
 * full. Run this after (re)starting Meilisearch or re-seeding the demo catalog:
 *
 *   pnpm search:reindex
 *
 * Reuses the exact DB→doc mapping from app/admin/experiences/actions.ts so the
 * indexed documents match what the publish path produces.
 */
import { eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { experiences, vendorProfiles } from '@/db/schema'
import { loadExperienceRatingMap } from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import {
  ensureExperienceIndexSettings,
  indexExperience,
  type ExperienceSearchDoc,
} from '@/lib/search/indexer'

async function main(): Promise<void> {
  await ensureExperienceIndexSettings()

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      vendorSlug: vendorProfiles.slug,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      isCombo: experiences.isCombo,
      difficulty: experiences.difficulty,
      durationMinutes: experiences.durationMinutes,
      maxGroupSize: experiences.maxGroupSize,
      seasonMonths: experiences.seasonMonths,
      // Issue 10 trust-oriented filter fields — all REAL data (D0).
      requiresSafetyStack: experiences.requiresSafetyStack,
      cancellationPreset: experiences.cancellationPreset,
      vendorKycTier: vendorProfiles.kycTier,
      updatedAt: experiences.updatedAt,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(publiclyVisibleExperienceCondition())

  // Issue 10: batch-load the published-review rating aggregate for every row
  // (one group-by query, no N+1 — reuses the card-badges loader so the indexed
  // ratingAvg matches what the cards show). Absent => unrated => 0.
  const ratingMap = await loadExperienceRatingMap(
    db,
    rows.map((r) => r.id),
  )

  let indexed = 0
  for (const exp of rows) {
    const doc: ExperienceSearchDoc = {
      id: exp.id,
      slug: exp.slug,
      title: exp.title,
      shortDescription: exp.shortDescription,
      activitySlug: exp.activitySlug,
      regionSlug: exp.regionSlug,
      vendorSlug: exp.vendorSlug,
      pricePerPersonRupees: Math.round(Number(exp.pricePerPerson_1_2)),
      isCombo: exp.isCombo,
      publishedAt: exp.updatedAt ?? new Date(),
      difficulty: exp.difficulty,
      durationMinutes: exp.durationMinutes,
      maxGroupSize: exp.maxGroupSize,
      seasonMonths: exp.seasonMonths ?? [],
      // Issue 10 trust-oriented filter fields. Unrated => ratingAvg 0 (NOT null)
      // so the numeric attribute is always present (documented choice).
      ratingAvg: ratingMap.get(exp.id)?.avg ?? 0,
      requiresSafetyStack: exp.requiresSafetyStack,
      vendorKycTier: exp.vendorKycTier,
      cancellationPreset: exp.cancellationPreset,
    }
    await indexExperience(doc)
    indexed++
  }

  console.log(`Reindexed ${indexed} published experiences into Meilisearch.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Reindex failed:', err)
  process.exit(1)
})
