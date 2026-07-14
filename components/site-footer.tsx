'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactElement } from 'react'

import { isBackOfficePath } from '@/lib/chrome/back-office-path'

import { LanguageSelector } from './language-selector'
import { NewsletterForm } from './newsletter-form'

/**
 * Bottom-of-page footer present on every public route. v3 (issue 02):
 * a confident brand band (wordmark + tagline + newsletter) leads, then a
 * link grid (Explore, Support, For Vendors, Contact + social), then the
 * copyright bar. NO trust/accreditation badges — Outvers holds none and
 * they are explicitly out of scope (CONTEXT.md).
 *
 * Cancellation policy is the load-bearing link (ADR-0005 -- "link to it
 * from every Experience card") so it appears in both header and footer.
 */

export function SiteFooter(): ReactElement | null {
  const pathname = usePathname()
  const t = useTranslations('Nav')
  const tf = useTranslations('Nav.footer')

  // E: this consumer footer lives in the root layout — hide it inside the
  // /admin + /vendor back-office (which have their own portal shells).
  if (isBackOfficePath(pathname)) return null

  return (
    <footer className="mt-16 border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {/* Brand band: wordmark + tagline + newsletter. Full-width on base,
            two-up from md (statement left, newsletter right). */}
        <div className="grid gap-8 border-b border-border pb-10 md:grid-cols-2 md:items-start lg:gap-12">
          <div>
            <Link
              href="/"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              aria-label={t('homeAriaLabel')}
            >
              {t('home')}
            </Link>
            {/* Brand tagline (home-redesign issue 03 / CR10) sits tight under
                the wordmark; the keyword-bearing descriptive tagline below is
                unchanged (it carries the SEO copy). */}
            <p className="mt-1.5 text-sm font-medium text-foreground/80">
              {tf('brandTagline')}
            </p>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">{tf('tagline')}</p>
            <div className="mt-5">
              <LanguageSelector variant="full" />
            </div>
          </div>
          {/* Issue 01 newsletter capture — kept mounted on every public page,
              integrated into the brand band. */}
          <div className="w-full max-w-sm md:justify-self-end">
            <NewsletterForm />
          </div>
        </div>

        {/* Link grid: Explore / Support / For Vendors + Contact & social. */}
        <div className="mt-10 grid grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">
          <nav
            aria-label="Footer navigation"
            className="col-span-2 grid grid-cols-2 gap-8 md:col-span-3 md:grid-cols-3"
          >
            {/* Explore */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tf('explore')}
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/search" className="text-foreground/80 transition hover:text-foreground">
                    {t('search')}
                  </Link>
                </li>
                <li>
                  <Link href="/adventure/rafting-in-rishikesh" className="text-foreground/80 transition hover:text-foreground">
                    {t('adventures')}
                  </Link>
                </li>
                <li>
                  <Link href="/search?activity=paragliding" className="text-foreground/80 transition hover:text-foreground">
                    {tf('paragliding')}
                  </Link>
                </li>
                <li>
                  <Link href="/search?activity=scuba-diving" className="text-foreground/80 transition hover:text-foreground">
                    {tf('scubaDiving')}
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="text-foreground/80 transition hover:text-foreground">
                    {tf('blog')}
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="text-foreground/80 transition hover:text-foreground">
                    {tf('about')}
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tf('support')}
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/cancellation-policy" className="text-foreground/80 transition hover:text-foreground">
                    {t('refundPolicy')}
                  </Link>
                </li>
                <li>
                  <Link href="/safety" className="text-foreground/80 transition hover:text-foreground">
                    {tf('safety')}
                  </Link>
                </li>
                <li>
                  <Link href="/help" className="text-foreground/80 transition hover:text-foreground">
                    {tf('helpCentre')}
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="text-foreground/80 transition hover:text-foreground">
                    {tf('contactUs')}
                  </Link>
                </li>
              </ul>

              {/* Legal drafts (issue 07) — reachable from every public page.
                  The canonical /cancellation-policy calculator link stays under
                  the Support list above; these are the four legal documents.
                  min-tap meets the §8.2 44px coarse-pointer floor. */}
              <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tf('legal')}
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link
                    href="/terms"
                    className="min-tap inline-flex items-center text-foreground/80 transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {tf('terms')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy"
                    className="min-tap inline-flex items-center text-foreground/80 transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {tf('privacy')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/refund-cancellation"
                    className="min-tap inline-flex items-center text-foreground/80 transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {tf('refundCancellation')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/vendor-terms"
                    className="min-tap inline-flex items-center text-foreground/80 transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {tf('vendorTerms')}
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tf('forVendors')}
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/vendor-partner" className="text-foreground/80 transition hover:text-foreground">
                    {tf('listYourExperience')}
                  </Link>
                </li>
                <li>
                  <Link href="/vendor/dashboard" className="text-foreground/80 transition hover:text-foreground">
                    {tf('vendorDashboard')}
                  </Link>
                </li>
              </ul>
            </div>
          </nav>

          {/* Contact column. Social icons are intentionally ABSENT until real
              account URLs exist — an icon row of dead `#` anchors reads as
              unfinished (QA fix pass; restore with real hrefs when handles
              are live). */}
          <div className="col-span-2 md:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tf('contactHeading')}
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a
                  href="mailto:support@outvers.com"
                  aria-label={tf('emailUs')}
                  className="min-tap inline-flex items-center text-foreground/80 transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  support@outvers.com
                </a>
              </li>
              <li>
                <Link href="/contact" className="text-foreground/80 transition hover:text-foreground">
                  {tf('contactUs')}
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
          &copy; {new Date().getFullYear()} Outvers. {tf('copyright')}
        </p>
      </div>
    </footer>
  )
}
