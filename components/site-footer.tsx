'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactElement, ReactNode } from 'react'

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

// Social glyphs. lucide-react ships no brand icons, so these are small inline
// SVG marks (currentColor, aria-hidden — the accessible name lives on the <a>).
function InstagramGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

function YouTubeGlyph(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.57V8.43L15.82 12 9.6 15.57z" />
    </svg>
  )
}

function FacebookGlyph(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  )
}

function XGlyph(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  )
}

interface SocialLink {
  glyph: ReactNode
  label: string
}

export function SiteFooter(): ReactElement | null {
  const pathname = usePathname()
  const t = useTranslations('Nav')
  const tf = useTranslations('Nav.footer')

  // E: this consumer footer lives in the root layout — hide it inside the
  // /admin + /vendor back-office (which have their own portal shells).
  if (isBackOfficePath(pathname)) return null

  // Placeholder social targets: intentionally `#` until real accounts exist
  // (issue 02 / CONTEXT.md). Accessible names come from i18n; glyphs are
  // aria-hidden inline SVGs.
  const socialLinks: SocialLink[] = [
    { glyph: <InstagramGlyph />, label: tf('social.instagram') },
    { glyph: <YouTubeGlyph />, label: tf('social.youtube') },
    { glyph: <FacebookGlyph />, label: tf('social.facebook') },
    { glyph: <XGlyph />, label: tf('social.x') },
  ]

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
                  <Link href="/vendor-partner" className="text-foreground/80 transition hover:text-foreground">
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
                    quiet roadmap note, not an unfinished link. */}
                <li>
                  <span className="text-2xs text-muted-foreground/70">{tf('vendorKyc')}</span>
                </li>
              </ul>
            </div>
          </nav>

          {/* Contact & social. Spans both columns on base so it doesn't crowd
              the link nav; its own column from md. */}
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

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tf('followUs')}
            </h3>
            <ul className="mt-3 flex flex-wrap items-center gap-2">
              {socialLinks.map((social) => (
                <li key={social.label}>
                  {/* Placeholder `#` target — dead until real accounts exist
                      (issue 02 / CONTEXT.md). min-tap meets the §8.2 44px
                      coarse-pointer floor for these icon-only links. */}
                  <a
                    href="#"
                    aria-label={social.label}
                    className="min-tap inline-flex items-center justify-center rounded-md p-2 text-foreground/70 transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {social.glyph}
                  </a>
                </li>
              ))}
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
