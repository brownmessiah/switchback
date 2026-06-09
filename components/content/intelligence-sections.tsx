import type { ReactElement } from 'react'

import Link from 'next/link'
import { BarChart3, Gauge, IndianRupee, MapPin, Sparkles } from 'lucide-react'

import { ExperienceCard } from '@/components/experience-card'
import type {
  ActivityIntelligence,
  Difficulty,
  FeaturedExperience,
  RegionIntelligence,
} from '@/lib/content/intelligence'

/**
 * Data-derived intelligence sections (issue 22, DATA half only).
 *
 * Pure presentational server components: they render ONLY the sections that
 * have data, so a destination/activity with no published inventory shows
 * nothing extra (empty-safe — the page passes the derived object straight
 * through). NO prose / AI text is rendered here (that is issue #23).
 *
 * All human-readable labels are resolved by the calling page (locale-aware)
 * and passed in as plain strings, keeping this component free of `next-intl`
 * coupling and trivially renderable in any locale.
 */

export interface IntelligenceLabels {
  priceRangeHeading: string
  /** Render the "From ₹X to ₹Y" string for a min/max pair. */
  priceRangeValue: (range: { minRupees: number; maxRupees: number }) => string
  difficultyHeading: string
  /** Localised name for a difficulty level. */
  difficultyLabel: (difficulty: Difficulty) => string
  /** Render the "{label} ({count})" chip text. */
  countChip: (label: string, count: number) => string
  featuredHeading: string
  /** Localised display name for an activity slug (falls back to the slug). */
  activityName: (slug: string) => string
  /** Localised display name for a region slug (falls back to the slug). */
  regionName: (slug: string) => string
}

export interface RegionIntelligenceLabels extends IntelligenceLabels {
  topActivitiesHeading: string
  nearbyHeading: string
}

export interface ActivityIntelligenceLabels extends IntelligenceLabels {
  topDestinationsHeading: string
}

function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: typeof MapPin
  children: string
}): ReactElement {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-heading text-h3 font-semibold tracking-tight">
      <Icon className="size-5 shrink-0 text-primary-strong" aria-hidden="true" />
      {children}
    </h2>
  )
}

function Chips({ items }: { items: string[] }): ReactElement {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((label) => (
        <li
          key={label}
          className="rounded-full border bg-muted/40 px-3 py-1 text-sm text-foreground"
        >
          {label}
        </li>
      ))}
    </ul>
  )
}

function LinkedChips({
  items,
}: {
  items: Array<{ href: string; label: string }>
}): ReactElement {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ href, label }) => (
        <li key={href}>
          <Link
            href={href}
            className="inline-block rounded-full border bg-muted/40 px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function PriceRangeSection({
  heading,
  value,
}: {
  heading: string
  value: string
}): ReactElement {
  return (
    <section className="mb-[var(--space-section)]" data-testid="intelligence-price-range">
      <SectionHeading icon={IndianRupee}>{heading}</SectionHeading>
      <p className="text-base font-medium text-foreground">{value}</p>
    </section>
  )
}

function DifficultySection({
  heading,
  items,
}: {
  heading: string
  items: string[]
}): ReactElement {
  return (
    <section className="mb-[var(--space-section)]" data-testid="intelligence-difficulty">
      <SectionHeading icon={Gauge}>{heading}</SectionHeading>
      <Chips items={items} />
    </section>
  )
}

function FeaturedSection({
  heading,
  experiences,
}: {
  heading: string
  experiences: FeaturedExperience[]
}): ReactElement {
  return (
    <section className="mb-[var(--space-section)]" data-testid="intelligence-featured">
      <SectionHeading icon={Sparkles}>{heading}</SectionHeading>
      <div className="grid gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
        {experiences.map((exp) => (
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
            }}
          />
        ))}
      </div>
    </section>
  )
}

export function RegionIntelligenceSections({
  data,
  labels,
}: {
  data: RegionIntelligence
  labels: RegionIntelligenceLabels
}): ReactElement | null {
  const hasAny =
    data.priceRange !== null ||
    data.topActivities.length > 0 ||
    data.nearbyRegions.length > 0 ||
    data.difficultySpread.length > 0 ||
    data.featured.length > 0
  if (!hasAny) return null

  return (
    <>
      {data.priceRange && (
        <PriceRangeSection
          heading={labels.priceRangeHeading}
          value={labels.priceRangeValue(data.priceRange)}
        />
      )}

      {data.topActivities.length > 0 && (
        <section
          className="mb-[var(--space-section)]"
          data-testid="intelligence-top-activities"
        >
          <SectionHeading icon={BarChart3}>{labels.topActivitiesHeading}</SectionHeading>
          <LinkedChips
            items={data.topActivities.map((a) => ({
              href: `/activities/${a.slug}`,
              label: labels.countChip(labels.activityName(a.slug), a.count),
            }))}
          />
        </section>
      )}

      {data.nearbyRegions.length > 0 && (
        <section
          className="mb-[var(--space-section)]"
          data-testid="intelligence-nearby"
        >
          <SectionHeading icon={MapPin}>{labels.nearbyHeading}</SectionHeading>
          <LinkedChips
            items={data.nearbyRegions.map((r) => ({
              href: `/destinations/${r.slug}`,
              label: labels.countChip(labels.regionName(r.slug), r.count),
            }))}
          />
        </section>
      )}

      {data.difficultySpread.length > 0 && (
        <DifficultySection
          heading={labels.difficultyHeading}
          items={data.difficultySpread.map((d) =>
            labels.countChip(labels.difficultyLabel(d.difficulty), d.count),
          )}
        />
      )}

      {data.featured.length > 0 && (
        <FeaturedSection heading={labels.featuredHeading} experiences={data.featured} />
      )}
    </>
  )
}

export function ActivityIntelligenceSections({
  data,
  labels,
}: {
  data: ActivityIntelligence
  labels: ActivityIntelligenceLabels
}): ReactElement | null {
  const hasAny =
    data.priceRange !== null ||
    data.topRegions.length > 0 ||
    data.difficultySpread.length > 0 ||
    data.featured.length > 0
  if (!hasAny) return null

  return (
    <>
      {data.priceRange && (
        <PriceRangeSection
          heading={labels.priceRangeHeading}
          value={labels.priceRangeValue(data.priceRange)}
        />
      )}

      {data.topRegions.length > 0 && (
        <section
          className="mb-[var(--space-section)]"
          data-testid="intelligence-top-destinations"
        >
          <SectionHeading icon={MapPin}>{labels.topDestinationsHeading}</SectionHeading>
          <LinkedChips
            items={data.topRegions.map((r) => ({
              href: `/destinations/${r.slug}`,
              label: labels.countChip(labels.regionName(r.slug), r.count),
            }))}
          />
        </section>
      )}

      {data.difficultySpread.length > 0 && (
        <DifficultySection
          heading={labels.difficultyHeading}
          items={data.difficultySpread.map((d) =>
            labels.countChip(labels.difficultyLabel(d.difficulty), d.count),
          )}
        />
      )}

      {data.featured.length > 0 && (
        <FeaturedSection heading={labels.featuredHeading} experiences={data.featured} />
      )}
    </>
  )
}
