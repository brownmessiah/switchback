import Image from 'next/image'
import Link from 'next/link'

import { getActivityImage } from '@/lib/images'

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

export function ExperienceCard({ experience }: ExperienceCardProps) {
  const activityLabel = ACTIVITY_LABELS[experience.activitySlug] ?? experience.activitySlug
  const regionLabel = REGION_LABELS[experience.regionSlug] ?? experience.regionSlug
  const imageUrl = getActivityImage(experience.activitySlug)

  return (
    <Link
      href={`/experience/${experience.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden">
        <Image
          src={imageUrl}
          alt={experience.title}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
        <div className="absolute left-2 top-2">
          <span className="inline-flex items-center rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {activityLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight">
          {experience.title}
        </h3>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {regionLabel}
          </span>
        </div>

        <div className="mt-auto pt-1">
          <span className="text-sm font-bold text-primary">
            ₹{experience.pricePerParticipantRupees.toLocaleString('en-IN')}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">/ person</span>
        </div>
      </div>
    </Link>
  )
}
