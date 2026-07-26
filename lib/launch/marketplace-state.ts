/**
 * Marketplace state (launch-readiness 04).
 *
 * outvers.com ships before it has inventory. The home page composes
 * itself differently in that window — blog-led, Vendor recruitment
 * primary, no dead Experience rails — but the switch is DERIVED FROM
 * DATA, never a manual flag. The day a real Vendor publishes their
 * first Experience, the home page becomes the live marketplace home by
 * itself; nobody has to remember to flip anything on launch day, and
 * nobody can leave it flipped the wrong way.
 *
 * "Publicly visible" is the existing shared condition, so this agrees
 * with what the home page's rails would actually render — status gates
 * out draft/pending/paused/archived, and the fixture slug list gates
 * out test scaffolding.
 */

import { count } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

export type MarketplaceState = 'pre-launch' | 'live'

export async function getMarketplaceState(db: DBOrTx): Promise<MarketplaceState> {
  const [row] = await db
    .select({ total: count() })
    .from(experiences)
    .where(publiclyVisibleExperienceCondition())
    .limit(1)

  return (row?.total ?? 0) > 0 ? 'live' : 'pre-launch'
}
