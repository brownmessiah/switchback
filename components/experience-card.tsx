import Link from 'next/link'

import { Badge } from '@/components/ui/badge'

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
}

interface ExperienceCardProps {
  experience: ExperienceCardData
}

const ACTIVITY_LABELS: Record<string, string> = {
  rafting: 'Rafting',
  paragliding: 'Paragliding',
  scuba: 'Scuba diving',
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

export function ExperienceCard({ experience }: ExperienceCardProps) {
  const activityLabel = ACTIVITY_LABELS[experience.activitySlug] ?? experience.activitySlug
  const regionLabel = REGION_LABELS[experience.regionSlug] ?? experience.regionSlug

  return (
    <Link
      href={`/experience/${experience.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-foreground/20 hover:shadow-md"
    >
      <div className="aspect-[16/10] w-full bg-muted">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {activityLabel}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {activityLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">{regionLabel}</span>
        </div>

        <h3 className="text-base font-semibold leading-snug group-hover:text-primary">
          {experience.title}
        </h3>

        {experience.shortDescription && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {experience.shortDescription}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-base font-semibold">
            ₹{experience.pricePerParticipantRupees.toLocaleString('en-IN')}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              / person
            </span>
          </span>

          {experience.vendorName && (
            <span className="text-xs text-muted-foreground">
              {experience.vendorName}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
