import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import {
  ShieldCheck,
  Phone,
  IdCard,
  Building2,
  Wallet,
  CalendarClock,
  MapPin,
  Siren,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { generateAlternates } from '@/lib/seo/hreflang'

/**
 * Safety + trust page (issue 06).
 *
 * Every claim here is backed by a shipped feature and a load-bearing ADR —
 * no aspirational copy:
 *   - Three-tier KYC verification ladder (phone → identity → business): ADR-0007.
 *   - Cancellation presets + pure-function refund math + two-bucket wallet
 *     (Outvers credit / Refund balance): ADR-0005 + ADR-0004.
 *   - Partial pay (25% Advance now, 75% auto-captured at T-24h): CONTEXT.md / ADR-0001.
 *   - Required permits surfaced (not brokered): ADR-0011.
 *   - Safety stack (trusted contact / SOS event / check-in pings) with the
 *     "notification, not emergency response" posture: ADR-0015.
 *
 * Static SSR — no DB. Mirrors the cancellation-policy template's i18n approach
 * (generateMetadata + generateAlternates, setRequestLocale, namespaced
 * getTranslations, breadcrumb, capped measure, DESIGN.md tokens).
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'SafetyPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/safety', locale),
  }
}

export default async function SafetyPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'SafetyPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const emailAddress = t('contact.emailAddress')

  const kycTiers = [
    { Icon: Phone, title: t('kyc.phoneTitle'), body: t('kyc.phoneBody') },
    { Icon: IdCard, title: t('kyc.identityTitle'), body: t('kyc.identityBody') },
    { Icon: Building2, title: t('kyc.businessTitle'), body: t('kyc.businessBody') },
  ]

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-primary-strong">
            {tCommon('breadcrumb.home')}
          </Link>{' '}
          <span aria-hidden>&#8250;</span>{' '}
          <span aria-current="page" className="text-foreground">
            {t('breadcrumb.safety')}
          </span>
        </nav>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary-strong">
          <ShieldCheck className="size-4" aria-hidden />
          {t('breadcrumb.safety')}
        </span>
        <h1 className="mt-2 font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.description')}
        </p>
      </header>

      {/* KYC verification ladder — ADR-0007 */}
      <section aria-label={t('kyc.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('kyc.heading')}
        </h2>
        <p className="mb-5 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('kyc.intro')}
        </p>
        <ol className="space-y-4">
          {kycTiers.map(({ Icon, title, body }) => (
            <li
              key={title}
              className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-sm)]"
            >
              <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Icon className="size-5 text-primary-strong" aria-hidden />
                {title}
              </h3>
              <p className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Money rules — ADR-0005 / ADR-0004 / partial pay */}
      <section aria-label={t('money.heading')} className="mb-12">
        <h2 className="mb-5 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('money.heading')}
        </h2>
        <dl className="space-y-6">
          <div>
            <dt className="flex items-center gap-2 text-base font-medium text-foreground">
              <CalendarClock className="size-5 text-primary-strong" aria-hidden />
              {t('money.cancellationTitle')}
            </dt>
            <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('money.cancellationBody')}{' '}
              <Link
                href="/cancellation-policy"
                className="font-medium text-primary-strong underline underline-offset-2"
              >
                {t('money.cancellationLink')}
              </Link>
              .
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-base font-medium text-foreground">
              <Wallet className="size-5 text-primary-strong" aria-hidden />
              {t('money.walletTitle')}
            </dt>
            <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('money.walletBody')}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-base font-medium text-foreground">
              <CalendarClock className="size-5 text-primary-strong" aria-hidden />
              {t('money.partialPayTitle')}
            </dt>
            <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('money.partialPayBody')}
            </dd>
          </div>
        </dl>
      </section>

      {/* On the ground: permits + safety stack — ADR-0011 / ADR-0015 */}
      <section aria-label={t('onground.heading')} className="mb-12">
        <h2 className="mb-5 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('onground.heading')}
        </h2>
        <dl className="space-y-6">
          <div>
            <dt className="flex items-center gap-2 text-base font-medium text-foreground">
              <MapPin className="size-5 text-primary-strong" aria-hidden />
              {t('onground.permitsTitle')}
            </dt>
            <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('onground.permitsBody')}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-base font-medium text-foreground">
              <Siren className="size-5 text-primary-strong" aria-hidden />
              {t('onground.safetyStackTitle')}
            </dt>
            <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('onground.safetyStackBody')}
            </dd>
          </div>
          <div className="rounded-[var(--radius-card)] border border-border bg-surface-2 p-5">
            <dt className="flex items-center gap-2 text-base font-medium text-foreground">
              <ShieldCheck className="size-5 text-warning" aria-hidden />
              {t('onground.postureTitle')}
            </dt>
            <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('onground.postureBody')}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label={t('contact.heading')}>
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('contact.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-foreground">
          {t('contact.body', { email: emailAddress })
            .split(emailAddress)
            .map((part, i, arr) =>
              i < arr.length - 1 ? (
                <span key={i}>
                  {part}
                  <a
                    href={`mailto:${emailAddress}`}
                    className="font-medium text-primary-strong underline underline-offset-2"
                  >
                    {emailAddress}
                  </a>
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
        </p>
      </section>
    </main>
  )
}
