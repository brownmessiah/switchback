import Image from 'next/image'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
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
      className="group flex flex-col overflow-hidden rounded-2xl bg-card transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <Image
          src={imageUrl}
          alt={experience.title}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-4 pt-12">
          <Badge className="bg-white/90 text-foreground hover:bg-white text-xs font-medium">
            {activityLabel}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {regionLabel}
        </div>

        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">
          {experience.title}
        </h3>

        {experience.vendorName && (
          <p className="text-xs text-muted-foreground">
            by {experience.vendorName}
          </p>
        )}

        <div className="mt-auto pt-3">
          <span className="text-[15px] font-semibold">
            ₹{experience.pricePerParticipantRupees.toLocaleString('en-IN')}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">/ person</span>
        </div>
      </div>
    </Link>
  )
}
