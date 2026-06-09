import { and, eq } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Public vendor storefront catalogue loader (`/vendor/{slug}`).
 *
 * Returns the card-ready columns for the Experiences a Vendor's public
 * storefront grid renders. This is a PUBLIC list-query: only publicly
 * visible Experiences (published + non-fixture) may appear here.
 */
export interface VendorPublicExperienceRow {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  pricePerPerson_1_2: string
  regionSlug: string
  activitySlug: string
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
}

export async function loadVendorPublicExperiences(
  db: DBOrTx,
  vendorUserId: string,
): Promise<VendorPublicExperienceRow[]> {
  return db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
      difficulty: experiences.difficulty,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        publiclyVisibleExperienceCondition(),
      ),
    )
}
