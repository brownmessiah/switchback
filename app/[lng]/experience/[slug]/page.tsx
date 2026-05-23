import type { ReactElement } from 'react'

import { notFound, redirect } from 'next/navigation'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { getRedis } from '@/lib/redis'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { product } from '@/lib/seo/schemas/product'

/**
 * Experience detail page per ADR-0013. Canonical URL for every Experience
 * regardless of inbound path. Server Component, ISR revalidate=60.
 *
 * Flow:
 *   1. Try loading the Experience by slug (published only).
 *   2. If not found, check slug_redirects (Redis-cached 24h, DB fallback).
 *   3. If redirect found → 301 to canonical slug.
 *   4. If neither → notFound().
 *   5. Render with Product + FAQPage + BreadcrumbList JSON-LD.
 *   6. If required permits present, render the permit acknowledgement panel.
 */

export const revalidate = 60

interface PageProps {
  params: Promise<{ lng: string; slug: string }>
}

export default async function ExperienceDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { lng, slug } = await params

  const cacheKey = `slug-redirect:experience:${slug}`
  const redis = getRedis()
  const cachedRedirect = await redis.get(cacheKey)
  if (cachedRedirect) {
    const prefix = `/${lng}`
    redirect(`${prefix}/experience/${cachedRedirect}`)
  }

  const result = await loadExperienceDetail(db, { lng, slug })

  if (!result) {
    notFound()
  }

  if (result.type === 'redirect') {
    await redis.set(cacheKey, result.canonicalSlug, { ex: 24 * 60 * 60 })
    const prefix = `/${lng}`
    redirect(`${prefix}/experience/${result.canonicalSlug}`)
  }

  const detail = result.data
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const prefix = `/${lng}`
  const canonicalUrl = `${baseUrl}${prefix}/experience/${detail.slug}`
  const activityDisplay =
    lng === 'hi' ? detail.activity.displayName.hi : detail.activity.displayName.en
  const regionDisplay =
    lng === 'hi' ? detail.region.displayName.hi : detail.region.displayName.en

  const productJson = product({
    name: detail.title,
    url: canonicalUrl,
    description: detail.shortDescription ?? `${activityDisplay} Experience in ${regionDisplay}`,
    priceRupees: detail.pricePerPerson_1_2,
  })

  const breadcrumbsJson = breadcrumbList([
    { name: 'Home', url: `${baseUrl}${prefix || '/'}` },
    {
      name: `${activityDisplay} in ${regionDisplay}`,
      url: `${baseUrl}${prefix}/adventure/${detail.activity.slug}-in-${detail.region.slug}`,
    },
    { name: detail.title, url: canonicalUrl },
  ])

  const faqItems = [
    {
      question: `Is ${detail.title} safe?`,
      answer:
        'All Outvers-listed Experiences are run by KYC-verified Vendors. Safety-stack Experiences require a trusted contact and feature in-trip check-in pings.',
    },
    {
      question: `What is the cancellation policy for ${detail.title}?`,
      answer: `This Experience follows the ${detail.cancellationPreset} cancellation policy. Refunds for inside-policy cancellations credit to your Outvers wallet within 24 hours.`,
    },
    {
      question: 'How does payment work?',
      answer:
        detail.paymentModesAllowed.includes('partial_pay')
          ? 'You can pay 25% now and the rest 24 hours before the Experience starts. Full upfront payment is also available.'
          : 'Full payment is collected at booking time.',
    },
  ]
  const faqJson = faqPage(faqItems)

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }}
      />

      <header>
        <nav aria-label="Breadcrumb">
          <ol>
            <li>
              <a href={`${prefix || '/'}`}>Home</a>
            </li>
            <li>
              <a
                href={`${prefix}/adventure/${detail.activity.slug}-in-${detail.region.slug}`}
              >
                {activityDisplay} in {regionDisplay}
              </a>
            </li>
            <li aria-current="page">{detail.title}</li>
          </ol>
        </nav>
        <h1>{detail.title}</h1>
        <p>
          by{' '}
          <a href={`${prefix}/vendor/${detail.vendor.slug}`}>
            {detail.vendor.businessName}
          </a>
        </p>
      </header>

      {detail.shortDescription && (
        <section aria-label="Overview">
          <p>{detail.shortDescription}</p>
        </section>
      )}

      {detail.longDescription && (
        <section aria-label="Details">
          <p>{detail.longDescription}</p>
        </section>
      )}

      <section aria-label="Pricing">
        <h2>Pricing</h2>
        <dl>
          <dt>1-2 participants</dt>
          <dd>₹{detail.pricePerPerson_1_2} per person</dd>
          <dt>3-5 participants</dt>
          <dd>₹{detail.pricePerPerson_3_5} per person</dd>
          <dt>6+ participants</dt>
          <dd>₹{detail.pricePerPerson_6_plus} per person</dd>
        </dl>
      </section>

      <section aria-label="Cancellation policy">
        <h2>Cancellation Policy</h2>
        <p>
          This Experience follows the <strong>{detail.cancellationPreset}</strong>{' '}
          cancellation policy.
        </p>
      </section>

      {detail.requiredPermits.length > 0 && (
        <section aria-label="Required permits">
          <h2>Required Permits</h2>
          <p>
            You need the following permits before participating in this
            Experience. Outvers does not obtain permits on your behalf.
          </p>
          <ul>
            {detail.requiredPermits.map((permit) => (
              <li key={permit}>{permit.replace(/_/g, ' ')}</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              name="acknowledgedPermits"
              value="true"
            />
            I acknowledge that I need to obtain the listed permits before the
            Experience date
          </label>
        </section>
      )}

      <section aria-label="FAQ">
        <h2>Frequently Asked Questions</h2>
        <dl>
          {faqItems.map((item) => (
            <div key={item.question}>
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}

export async function generateMetadata({ params }: PageProps): Promise<{
  title: string
  description: string
  alternates: { canonical: string }
}> {
  const { lng, slug } = await params
  const result = await loadExperienceDetail(db, { lng, slug })

  if (!result || result.type !== 'found') {
    return {
      title: 'Not found · Outvers',
      description: '',
      alternates: { canonical: '' },
    }
  }

  const detail = result.data
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const prefix = `/${lng}`
  const activityDisplay =
    lng === 'hi' ? detail.activity.displayName.hi : detail.activity.displayName.en
  const regionDisplay =
    lng === 'hi' ? detail.region.displayName.hi : detail.region.displayName.en

  return {
    title: `${detail.title} · ${activityDisplay} in ${regionDisplay} · Outvers`,
    description:
      detail.shortDescription ??
      `Book ${detail.title} in ${regionDisplay} from a KYC-verified Vendor. Transparent pricing, 24-hour refund SLA.`,
    alternates: {
      canonical: `${baseUrl}${prefix}/experience/${detail.slug}`,
    },
  }
}
