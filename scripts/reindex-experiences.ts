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
      updatedAt: experiences.updatedAt,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(publiclyVisibleExperienceCondition())

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
