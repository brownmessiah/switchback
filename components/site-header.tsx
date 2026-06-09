'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'

import { isBackOfficePath } from '@/lib/chrome/back-office-path'

import { AuthStatus } from './auth-status'
import { LanguageSelector } from './language-selector'
import { ThemeToggle } from './theme-toggle'

/**
 * Discovery-forward primary nav (issue 03, DECISION D2). Five surfaces, all
 * resolving:
 *   - Explore → /search        (the full experience grid; label-only — no route rename)
 *   - Destinations → /destinations
 *   - Activities → /search      (activity-browse; there is no /activities index
 *                                route, so this lands on the canonical search
 *                                grid, mirroring the home "all activities" link)
 *   - Safety → /safety
 *   - Blog → /blog
 *
 * The old vague "Community" tab is GONE from the primary bar — the (real)
 * Trip Groups product (ADR-0009) moves into the user menu. The /community
 * routes stay intact; only the nav tab is removed.
 */
const NAV_LINKS = [
  { href: '/search', key: 'explore' },
  { href: '/destinations', key: 'destinations' },
  { href: '/search', key: 'activities' },
  { href: '/safety', key: 'safety' },
  { href: '/blog', key: 'blog' },
] as const

/**
 * Supply-side CTA → the public /vendor-partner landing page (issue 06), which
 * funnels into the auth-gated /vendor/onboarding. The nav points at the
 * crawlable partner page, not the onboarding route itself.
 */
const VENDOR_CTA_HREF = '/vendor-partner'

export function SiteHeader(): ReactElement | null {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const t = useTranslations('Nav')

  // E: the consumer chrome lives in the root layout — hide it inside the
  // /admin + /vendor back-office (which have their own portal shells).
  if (isBackOfficePath(pathname)) return null

  return (
    <header
      className={
        isHome
          ? 'absolute top-0 z-40 w-full'
          : 'sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur'
      }
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          className={`text-lg font-semibold tracking-tight ${isHome ? 'text-white' : ''}`}
          aria-label={t('homeAriaLabel')}
        >
          {t('home')}
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={
                isHome
                  ? 'text-sm text-white/80 hover:text-white'
                  : 'text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {t(link.key)}
            </Link>
          ))}
          <Link
            href={VENDOR_CTA_HREF}
            className={
              isHome
                ? 'text-sm font-medium text-white hover:text-white/80'
                : 'text-sm font-medium text-foreground hover:text-foreground/80'
            }
          >
            {t('listYourExperience')}
          </Link>
          <ThemeToggle
            label={t('themeToggle')}
            className={isHome ? 'text-white hover:bg-white/10 hover:text-white' : ''}
          />
          <LanguageSelector variant="compact" />
          <AuthStatus />
        </nav>

        <details className="sm:hidden">
          <summary
            className={`cursor-pointer list-none rounded-md p-2 ${isHome ? 'text-white' : 'text-muted-foreground'}`}
            aria-label={t('openMenu')}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </summary>
          <nav
            aria-label="Mobile primary"
            className="absolute right-4 mt-2 flex w-56 flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className="min-tap flex items-center rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                {t(link.key)}
              </Link>
            ))}
            <Link
              href={VENDOR_CTA_HREF}
              className="min-tap flex items-center rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t('listYourExperience')}
            </Link>
            <div className="flex items-center gap-1 px-1 py-1">
              <ThemeToggle label={t('themeToggle')} />
              <LanguageSelector variant="compact" />
            </div>
            <Link
              href="/sign-in"
              className="min-tap flex items-center rounded px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              {t('signIn')}
            </Link>
          </nav>
        </details>
      </div>
    </header>
  )
}
