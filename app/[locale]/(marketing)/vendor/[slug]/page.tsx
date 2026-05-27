import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ExperienceCard } from '@/components/experience-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { experiences, vendorProfiles } from '@/db/schema'
import { env } from '@/lib/env'

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

/** Pre-resolved KYC badge variant map — no dynamic translation keys. */
const KYC_BADGE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  business: 'default',
  identity: 'secondary',
  phone: 'outline',
}

export default async function VendorProfilePage({ params }: PageProps) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'VendorPage' })

  const [vendor] = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.slug, slug))
    .limit(1)

  if (!vendor) notFound()

  const vendorExperiences = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
    })
    .from(experiences)
    .where(eq(experiences.vendorUserId, vendor.userId))

  /** Pre-resolved KYC label map — no dynamic keys. */
  const kycLabels: Record<string, string> = {
    business: t('kyc.business'),
    identity: t('kyc.identity'),
    phone: t('kyc.phone'),
  }

  const kycBadgeVariant = KYC_BADGE_VARIANTS[vendor.kycTier] ?? KYC_BADGE_VARIANTS.phone
  const kycLabel = kycLabels[vendor.kycTier] ?? kycLabels.phone
  const slaScore = Math.floor(Number(vendor.responseTimeSlaScore))

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {/* Vendor header */}
      <div className="mb-8">
        <div className="flex items-start gap-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground">
            {vendor.businessName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {vendor.businessName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={kycBadgeVariant}>{kycLabel}</Badge>
              <span className="text-sm text-muted-foreground">
                {t('stats.responseScore', { score: slaScore })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-semibold">{vendorExperiences.length}</p>
            <p className="text-xs text-muted-foreground">{t('stats.experiences')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-semibold capitalize">{vendor.kycTier}</p>
            <p className="text-xs text-muted-foreground">{t('stats.verification')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-semibold">{slaScore}%</p>
            <p className="text-xs text-muted-foreground">{t('stats.responseRate')}</p>
          </CardContent>
        </Card>
      </div>

      <Separator className="mb-8" />

      {/* Experiences */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">
          {t('experiencesList.heading', { name: vendor.businessName })}
        </h2>
        {vendorExperiences.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center">
            <p className="text-muted-foreground">{t('experiencesList.empty')}</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {vendorExperiences.map((exp) => (
              <ExperienceCard
                key={exp.id}
                experience={{
                  id: exp.id,
                  slug: exp.slug,
                  title: exp.title,
                  shortDescription: exp.shortDescription,
                  pricePerParticipantRupees: Math.floor(Number(exp.pricePerPerson_1_2)),
                  regionSlug: exp.regionSlug,
                  activitySlug: exp.activitySlug,
                  vendorName: vendor.businessName,
                }}
              />
            ))}
          </div>
        )}
      </section>
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
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')

  return {
    title: t('metadata.title', { name: vendor.businessName }),
    description: t('metadata.description', { name: vendor.businessName }),
    alternates: {
      canonical: `${baseUrl}/vendor/${slug}`,
    },
  }
}
