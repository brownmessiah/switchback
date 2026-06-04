import { Heart } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { EmptyState } from '@/components/empty-state'
import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { getWishlistExperiences } from '@/lib/wishlist/wishlist'

/**
 * Customer wishlist page (Issue #08).
 *
 * Lives under app/(app)/ (NOT [locale]), so — like the dashboard
 * (app/(app)/dashboard/page.tsx) — it resolves auth via
 * `auth.api.getSession` and i18n via `getTranslations` against the request
 * context (the active locale comes from the cookie/header, resolved in
 * lib/i18n/request.ts). Saved Experiences render in an ExperienceCard grid;
 * each card opts into the heart toggle by passing `isWishlisted: true`.
 */
export default async function WishlistPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const t = await getTranslations('WishlistPage')
  const saved = await getWishlistExperiences(db, session.user.id)

  return (
    <main
      data-testid="wishlist-page"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">
        {t('heading')}
      </h1>

      {saved.length === 0 ? (
        <EmptyState
          data-testid="wishlist-empty"
          icon={Heart}
          title={t('empty.title')}
          description={t('empty.hint')}
          cta={{ href: '/search', label: t('empty.cta') }}
        />
      ) : (
        <div
          data-testid="wishlist-grid"
          className="grid grid-cols-1 gap-[var(--space-card-gap,1rem)] sm:grid-cols-2 lg:grid-cols-3"
        >
          {saved.map((exp) => (
            <ExperienceCard
              key={exp.id}
              experience={{
                id: exp.id,
                slug: exp.slug,
                title: exp.title,
                shortDescription: exp.shortDescription,
                pricePerParticipantRupees: exp.pricePerParticipantRupees,
                regionSlug: exp.regionSlug,
                activitySlug: exp.activitySlug,
                difficulty: exp.difficulty,
                ratingAvg: exp.ratingAvg,
                ratingCount: exp.ratingCount,
                highlight: exp.highlight,
                isWishlisted: true,
              }}
            />
          ))}
        </div>
      )}
    </main>
  )
}
