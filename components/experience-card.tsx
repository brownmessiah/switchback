import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MapPin, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { resolveExperienceCover } from '@/lib/media/experience-images'

export interface ExperienceCardData {
  id: string
  slug: string
  title: string
  shortDescription?: string | null
  pricePerParticipantRupees: number
  regionSlug: string
  activitySlug: string
  vendorName?: string
  vendorKycTier?: 'phone' | 'identity' | 'business'
  /**
   * Real per-listing cover image URL from `media_assets` (parity-catchup/02).
   * When absent, the card falls back to the activity stock photo.
   */
  coverImageUrl?: string | null
}

interface ExperienceCardProps {
  experience: ExperienceCardData
}

const ACTIVITY_LABELS: Record<string, string> = {
  rafting: 'Rafting',
  paragliding: 'Paragliding',
  scuba: 'Scuba diving',
  'scuba-diving': 'Scuba diving',
  trekking: 'Trekking',
  kayaking: 'Kayaking',
  camping: 'Camping',
  bungee: 'Bungee jumping',
  skiing: 'Skiing',
  surfing: 'Surfing',
  canyoning: 'Canyoning',
}

const REGION_LABELS: Record<string, string> = {
  rishikesh: 'Rishikesh',
  manali: 'Manali',
  'bir-billing': 'Bir Billing',
  goa: 'Goa',
  ladakh: 'Ladakh',
  sikkim: 'Sikkim',
  kerala: 'Kerala',
  meghalaya: 'Meghalaya',
  andaman: 'Andaman',
  coorg: 'Coorg',
}

/**
 * A1 Card (DESIGN.md §4) — decision-complete Experience tile.
 *
 * Unified card contract: `bg-card` (= --surface-1), `--radius-card`,
 * `--shadow-sm` resting → `--shadow-md` hover-lift (motion-reduce guarded).
 * Status overlay = a `--success` Free-cancellation Badge with a lucide icon
 * (status never by colour alone, §1.3). Price renders in `.tabular-nums`;
 * coral affordance uses `text-primary-strong` (AA-safe), never `text-primary`.
 */
export function ExperienceCard({ experience }: ExperienceCardProps) {
  const t = useTranslations('HomePage')
  const activityLabel = ACTIVITY_LABELS[experience.activitySlug] ?? experience.activitySlug
  const regionLabel = REGION_LABELS[experience.regionSlug] ?? experience.regionSlug
  const imageUrl = resolveExperienceCover(experience.coverImageUrl, experience.activitySlug)

  return (
    <Link
      href={`/experience/${experience.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden">
        <Image
          src={imageUrl}
          alt=""
          role="presentation"
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
        <div className="absolute left-2 top-2">
          <Badge variant="secondary" className="backdrop-blur-sm">
            {activityLabel}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-[var(--space-card-pad)]">
        <h3 className="line-clamp-2 font-heading text-sm font-semibold leading-snug tracking-tight">
          {experience.title}
        </h3>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden="true" />
          {regionLabel}
        </div>

        <Badge variant="success" className="self-start">
          <ShieldCheck aria-hidden="true" />
          {t('trustBadges.freeCancellation')}
        </Badge>

        <div className="mt-auto pt-1">
          <span className="text-sm font-bold tabular-nums text-foreground">
            ₹{experience.pricePerParticipantRupees.toLocaleString('en-IN')}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">/ person</span>
        </div>
      </div>
    </Link>
  )
}
