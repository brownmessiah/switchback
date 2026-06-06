'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactElement } from 'react'

import { isBackOfficePath } from '@/lib/chrome/back-office-path'

import { LanguageSelector } from './language-selector'

/**
 * Bottom-of-page footer present on every public route. v2 with
 * 4-column link grid (Explore, Company, Support, For Vendors).
 * Cancellation policy is the load-bearing link (ADR-0005 --
 * "link to it from every Experience card") so it appears in
 * both header and footer.
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
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight"
              aria-label={t('homeAriaLabel')}
            >
              {t('home')}
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              {tf('tagline')}
            </p>
            <div className="mt-4">
              <LanguageSelector variant="full" />
            </div>
          </div>

          <nav aria-label="Footer navigation" className="col-span-2 grid grid-cols-2 gap-8 md:col-span-3 md:grid-cols-3">
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
                  <Link href="/search?activity=scuba" className="text-foreground/80 transition hover:text-foreground">
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
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tf('forVendors')}
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/vendor/onboarding" className="text-foreground/80 transition hover:text-foreground">
                    {tf('listYourExperience')}
                  </Link>
                </li>
                <li>
                  <Link href="/vendor/dashboard" className="text-foreground/80 transition hover:text-foreground">
                    {tf('vendorDashboard')}
                  </Link>
                </li>
                {/* E: Vendor KYC is genuinely unbuilt (no destination). Kept as
                    a graceful, NON-INTERACTIVE "(soon)" stub — never a dead
                    <a href> 404 — and rendered in muted/2xs so it reads as a
                    quiet roadmap note, not an unfinished link. (The built links
                    above had their misleading "(soon)" suffixes dropped.) */}
                <li>
                  <span className="text-2xs text-muted-foreground/70">
                    {tf('vendorKyc')}
                  </span>
                </li>
              </ul>
            </div>
          </nav>
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
