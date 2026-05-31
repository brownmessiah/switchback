import type { ReactElement } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowRight, MapPin } from 'lucide-react'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { listRegionsWithCounts } from '@/lib/destinations/queries'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

export const revalidate = 60

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function DestinationsIndexPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'DestinationsPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const regions = await listRegionsWithCounts(db)

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const canonicalUrl = `${baseUrl}/destinations`

  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('index.breadcrumb'), url: canonicalUrl },
  ])

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-foreground">
              {tCommon('breadcrumb.home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground" aria-current="page">
            {t('index.breadcrumb')}
          </li>
        </ol>
      </nav>

      {/* Hero */}
      <header className="mb-[var(--space-section)]">
        <p className="mb-3 text-2xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-primary-strong">
          {t('index.heroEyebrow')}
        </p>
        <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
          {t('index.heroTitle')}
        </h1>
        <p className="measure mt-4 text-base text-muted-foreground">
          {t('index.heroSubtitle')}
        </p>
      </header>

      {/* Regions grid */}
      <section aria-label={t('index.regionsHeading')}>
        <h2 className="mb-4 font-heading text-h3 font-semibold tracking-tight">
          {t('index.regionsHeading')}
        </h2>
        <ul className="grid gap-[var(--space-grid-gap)] sm:grid-cols-2 lg:grid-cols-3">
          {regions.map(({ region, experienceCount, imageUrl }) => (
            <li key={region.slug}>
              <Link
                href={`/destinations/${region.slug}`}
                className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
              >
                <div className="relative aspect-[3/2] w-full overflow-hidden">
                  <Image
                    src={imageUrl}
                    alt=""
                    role="presentation"
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-[var(--space-card-pad)]">
                  <h3 className="font-heading text-base font-semibold tracking-tight">
                    {region.displayName.en}
                  </h3>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3 shrink-0" aria-hidden="true" />
                    {region.state}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {t('index.regionCount', { count: experienceCount })}
                    </span>
                    <span className="flex items-center gap-1 text-sm font-medium text-primary-strong">
                      {t('index.exploreCta', { region: region.displayName.en })}
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'DestinationsPage' })
  return {
    title: t('index.metadataTitle'),
    description: t('index.metadataDescription'),
    alternates: generateAlternates('/destinations', locale),
  }
}
