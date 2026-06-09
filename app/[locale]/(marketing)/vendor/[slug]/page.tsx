import { eq } from 'drizzle-orm'
import {
  BadgeCheck,
  Building2,
  CircleCheck,
  Clock,
  Compass,
  MapPin,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { EmptyState } from '@/components/empty-state'
import { ExperienceCard, type ExperienceCardData } from '@/components/experience-card'
import { Badge } from '@/components/ui/badge'
import { db } from '@/db/client'
import { vendorProfiles } from '@/db/schema'
import { env } from '@/lib/env'
import { enrichCardBadges } from '@/lib/experiences/card-badges'
import { loadExperienceCoverMap } from '@/lib/media/experience-images'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { vendorEntity } from '@/lib/seo/schemas/local-business'
import { loadVendorPublicExperiences } from '@/lib/vendor/public-profile'
import { loadVendorRatingAggregate } from '@/lib/vendor/rating-aggregate'

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

/**
 * Verification-tier label keys (no dynamic translation keys). The eyebrow/badge
 * over the storefront banner uses the same KYC label vocabulary as the rest of
 * the app (ADR-0007).
 */
const KYC_LABEL_KEYS: Record<string, string> = {
  business: 'kyc.business',
  identity: 'kyc.identity',
  phone: 'kyc.phone',
}

/**
 * Tier ordinal, used to decide which verification checks are *verified* vs
 * *pending* on the provenance rail. The tier ladder is cumulative
 * (business ⊇ identity ⊇ phone) per ADR-0007.
 */
const TIER_ORDER: Record<string, number> = { phone: 0, identity: 1, business: 2 }

/**
 * #41 Vendor profile — Direction B "Storefront Catalog" (DESIGN.md §4 B8).
 *
 * A branded Vendor storefront: a warm banner with the business name as H1 +
 * a verified-Vendor badge (`--success` + icon), a sticky trust rail surfacing
 * the real ADR-0007 verification provenance (what Identity / Business
 * verification actually checked, on the semantic Badge variants paired with a
 * lucide icon — status never by colour alone, §1.3/§5), and a dense A1
 * Experience grid (reusing components/experience-card.tsx unchanged).
 *
 * "Message Vendor" is rendered HONESTLY as a disabled coming-soon affordance —
 * cold customer→Vendor messaging has no production backend, so building it is
 * out of scope (see .scratch/mvp-validation-redesign/defects-log.md).
 */
export default async function VendorProfilePage({ params }: PageProps) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'VendorPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const [vendor] = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.slug, slug))
    .limit(1)

  if (!vendor) notFound()

  // Public storefront catalogue — only publicly visible (published +
  // non-fixture) Experiences surface here (issue 04, shared predicate).
  const vendorExperiences = await loadVendorPublicExperiences(db, vendor.userId)

  const vendorCoverMap = await loadExperienceCoverMap(
    db,
    vendorExperiences.map((e) => e.id),
  )
  const vendorCards: ExperienceCardData[] = await enrichCardBadges(
    db,
    vendorExperiences.map((exp) => ({
      id: exp.id,
      slug: exp.slug,
      title: exp.title,
      shortDescription: exp.shortDescription,
      pricePerParticipantRupees: Math.floor(Number(exp.pricePerPerson_1_2)),
      regionSlug: exp.regionSlug,
      activitySlug: exp.activitySlug,
      vendorName: vendor.businessName,
      coverImageUrl: vendorCoverMap.get(exp.id) ?? null,
      difficulty: exp.difficulty,
    })),
  )

  // Pre-resolved KYC label (no dynamic keys), used for the banner badge.
  const kycLabel = t(KYC_LABEL_KEYS[vendor.kycTier] ?? KYC_LABEL_KEYS.phone)

  // Verification provenance derived from the real KYC tier (ADR-0007). The
  // ladder is cumulative — an identity-tier Vendor has passed the Identity
  // check; the Business check is still pending until it reaches Tier 3.
  const tierRank = TIER_ORDER[vendor.kycTier] ?? 0
  const identityVerified = tierRank >= TIER_ORDER.identity
  const businessVerified = tierRank >= TIER_ORDER.business

  // Meaningful, token-true trust facts (replaces the vanity stats):
  // # Experiences and region coverage (distinct regionSlugs).
  const experienceCount = vendorExperiences.length
  const regionCount = new Set(vendorExperiences.map((e) => e.regionSlug)).size

  // Vendor JSON-LD (ADR-0013): LocalBusiness when Business-verified (KYC tier
  // 3), else Organization (lower tier). A Vendor is never an "operator" in
  // schema. aggregateRating is attached ONLY when real published reviews exist
  // (D0) — `loadVendorRatingAggregate` returns null otherwise so the block is
  // omitted (no fabricated rating).
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const vendorUrl = `${baseUrl}/vendor/${slug}`
  const ratingAggregate = await loadVendorRatingAggregate(db, vendor.userId)
  const vendorEntityJson = vendorEntity({
    name: vendor.businessName,
    url: vendorUrl,
    kycTier: vendor.kycTier,
    ratingValue: ratingAggregate?.ratingValue,
    ratingCount: ratingAggregate?.ratingCount,
  })
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: vendor.businessName, url: vendorUrl },
  ])

  return (
    <main className="bg-surface-0">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(vendorEntityJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />

      {/* ── Branded banner / hero ──────────────────────────────────────
          A warm coral-grey gradient band (token surface ramp, hue 30) with
          the business name as H1 + a verified-Vendor badge. */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="h-32 w-full bg-gradient-to-br from-surface-3 via-surface-2 to-primary/10 sm:h-40"
        />
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="-mt-10 flex flex-col gap-4 pb-6 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              {/* Storefront mark — initial monogram on a raised surface. */}
              <div className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface-1 font-heading text-h2 font-bold text-primary-strong shadow-[var(--shadow-sm)] sm:size-24">
                {vendor.businessName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 pb-1">
                <p className="text-2xs uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                  {t('eyebrow')}
                </p>
                <h1 className="font-heading text-h2 font-bold tracking-tight text-balance sm:text-h1">
                  {vendor.businessName}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="success">
                    <ShieldCheck aria-hidden="true" />
                    {kycLabel}
                  </Badge>
                </div>
              </div>
            </div>

            {/* "Message Vendor" — HONEST coming-soon affordance. Cold
                customer→Vendor messaging has no production backend, so this is
                a disabled <button> (not a dead link) with an accessible
                caption explaining it is not yet available. */}
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <button
                type="button"
                disabled
                aria-disabled="true"
                data-testid="message-vendor"
                aria-describedby="message-vendor-note"
                className="inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-muted px-4 text-sm font-medium text-muted-foreground opacity-60"
              >
                <MessageSquare aria-hidden="true" className="size-4 shrink-0" />
                {t('message.action')}
              </button>
              <p
                id="message-vendor-note"
                data-testid="message-vendor-note"
                className="text-2xs uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground"
              >
                {t('message.comingSoon')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body: sticky trust rail + dense Experience grid ─────────────── */}
      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:pb-16">
        <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
          {/* Sticky trust rail — verification provenance + trust facts. */}
          <aside
            data-testid="verification-provenance"
            aria-labelledby="trust-rail-heading"
            className="space-y-4 lg:sticky lg:top-[calc(var(--header-offset,4rem)+1rem)] lg:self-start"
          >
            <div className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-[var(--space-card-pad)] shadow-[var(--shadow-sm)]">
              <h2
                id="trust-rail-heading"
                className="text-2xs uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground"
              >
                {t('trust.provenanceHeading')}
              </h2>

              {/* Each provenance row = the semantic Badge variant (success when
                  the check passed, warning when still pending) PAIRED WITH a
                  lucide icon — status is never conveyed by colour alone. */}
              <ul className="mt-3 space-y-3">
                <li data-testid="provenance-identity" className="flex gap-3">
                  <BadgeCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{t('trust.identity.label')}</p>
                    <p className="text-xs text-muted-foreground">
                      {identityVerified
                        ? t('trust.identity.checkedDescription')
                        : t('trust.identity.pendingDescription')}
                    </p>
                    {identityVerified ? (
                      <Badge variant="success">
                        <CircleCheck aria-hidden="true" />
                        {t('trust.stateVerified')}
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <Clock aria-hidden="true" />
                        {t('trust.statePending')}
                      </Badge>
                    )}
                  </div>
                </li>

                <li data-testid="provenance-business" className="flex gap-3">
                  <Building2
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{t('trust.business.label')}</p>
                    <p className="text-xs text-muted-foreground">
                      {businessVerified
                        ? t('trust.business.checkedDescription')
                        : t('trust.business.pendingDescription')}
                    </p>
                    {businessVerified ? (
                      <Badge variant="success">
                        <CircleCheck aria-hidden="true" />
                        {t('trust.stateVerified')}
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <Clock aria-hidden="true" />
                        {t('trust.statePending')}
                      </Badge>
                    )}
                  </div>
                </li>
              </ul>
            </div>

            {/* Trust facts — meaningful, token-true (verification tier,
                # Experiences, region coverage); counts in .tabular-nums. */}
            <dl className="grid grid-cols-2 gap-3">
              <div className="col-span-2 rounded-[var(--radius-card)] border border-border bg-surface-1 p-[var(--space-card-pad)] shadow-[var(--shadow-sm)]">
                <dt className="text-2xs uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                  {t('stats.verification')}
                </dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-success">
                  <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
                  {kycLabel}
                </dd>
              </div>
              <div className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-[var(--space-card-pad)] shadow-[var(--shadow-sm)]">
                <dd className="font-heading text-h3 font-bold tabular-nums">
                  {experienceCount}
                </dd>
                <dt className="text-xs text-muted-foreground">
                  {t('stats.experiencesLabel')}
                </dt>
              </div>
              <div className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-[var(--space-card-pad)] shadow-[var(--shadow-sm)]">
                <dd className="flex items-center gap-1 font-heading text-h3 font-bold tabular-nums">
                  <MapPin
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  {regionCount}
                </dd>
                <dt className="text-xs text-muted-foreground">{t('stats.regionsLabel')}</dt>
              </div>
            </dl>
          </aside>

          {/* Dense Experience grid — A1 cards, ExperienceCard reused as-is. */}
          <section className="min-w-0">
            <h2 className="mb-4 font-heading text-h3 font-semibold tracking-tight">
              {t('experiencesList.heading', { name: vendor.businessName })}
            </h2>
            {experienceCount === 0 ? (
              <EmptyState
                data-testid="vendor-experiences-empty"
                icon={Compass}
                title={t('experiencesList.empty')}
                cta={{ href: '/search', label: tCommon('actions.search') }}
              />
            ) : (
              <div className="grid gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
                {vendorCards.map((card) => (
                  <ExperienceCard key={card.id} experience={card} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const [vendor] = await db
    .select({ businessName: vendorProfiles.businessName })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.slug, slug))
    .limit(1)

  if (!vendor) {
    const t = await getTranslations({ locale, namespace: 'VendorPage' })
    return { title: t('metadata.notFound') }
  }

  const t = await getTranslations({ locale, namespace: 'VendorPage' })

  return {
    title: t('metadata.title', { name: vendor.businessName }),
    description: t('metadata.description', { name: vendor.businessName }),
    alternates: generateAlternates(`/vendor/${slug}`, locale),
  }
}
