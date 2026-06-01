import type { ReactElement } from 'react'

import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Sparkles } from 'lucide-react'

import { listActivities } from '@/lib/activities/registry'
import { listRegions } from '@/lib/regions/registry'
import { generateAlternates } from '@/lib/seo/hreflang'

import { TripPlannerForm } from './trip-planner-form'

// Static shell; the itinerary itself is generated on demand via a Server Action.
export const revalidate = 3600

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function TripPlannerPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'TripPlannerPage' })

  const regions = listRegions().map((r) => ({
    slug: r.slug,
    label: r.displayName.en,
  }))
  const activities = listActivities().map((a) => ({
    slug: a.slug,
    label: a.displayName.en,
  }))

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-8">
        <p className="mb-3 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-primary-strong">
          <Sparkles aria-hidden="true" className="size-3.5" />
          {t('aiLabel')}
        </p>
        <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
          {t('heading')}
        </h1>
        <p className="measure mt-4 text-lg text-muted-foreground">{t('subheading')}</p>
      </header>

      <TripPlannerForm regions={regions} activities={activities} />
    </main>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'TripPlannerPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/trip-planner', locale),
  }
}
