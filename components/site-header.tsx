'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { Heart } from 'lucide-react'

import { isBackOfficePath } from '@/lib/chrome/back-office-path'

import { AuthStatus } from './auth-status'
import { LanguageSelector } from './language-selector'
import { ThemeToggle } from './theme-toggle'

/**
 * Customer-centric header (home-redesign issue 06 / CR4, decision D3 —
 * supersedes the 2026-06-11 minimal bar that carried the supply-side CTA):
 * wordmark, Wishlist, theme toggle, the FUNCTIONAL language selector with a
 * static "₹ INR" badge beside it (decision D5 — currency is decorative;
 * INR is the only charge currency, and locale routing/hreflang stay
 * untouched per ADR-0012/0013), and the auth control.
 *
 * The "List your experience" vendor CTA moved OUT of the header — the
 * supply side enters via the footer's "For Vendors" column (site-footer),
 * so it is not orphaned. Discovery links stay out too (footer's Explore/
 * Support columns; the hero search is the primary discovery entry).
 *
 * Wishlist points at the auth-gated /wishlist — a logged-out click lands on
 * /sign-in (accepted, per the issue).
 */

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

        <nav aria-label="Primary" className="hidden items-center gap-4 sm:flex">
          <Link
            href="/wishlist"
            className={`flex items-center gap-1.5 text-sm font-medium ${
              isHome
                ? 'text-white hover:text-white/80'
                : 'text-foreground hover:text-foreground/80'
            }`}
          >
            <Heart className="size-4" aria-hidden="true" />
            {t('wishlist')}
          </Link>
          <ThemeToggle
            label={t('themeToggle')}
            className={isHome ? 'text-white hover:bg-white/10 hover:text-white' : ''}
          />
          <div className="flex items-center gap-1.5">
            <LanguageSelector variant="compact" onDark={isHome} />
            {/* Static currency indicator (D5): INR is the only charge
                currency (razorpay-client hardcodes it) — this is a label,
                not a switcher. */}
            <span
              aria-label={t('currencyBadgeLabel')}
              className={`rounded-[var(--radius-pill)] border px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                isHome
                  ? 'border-white/30 text-white/90'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {t('currencyBadge')}
            </span>
          </div>
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
            <Link
              href="/wishlist"
              className="min-tap flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Heart className="size-4" aria-hidden="true" />
              {t('wishlist')}
            </Link>
            <div className="flex items-center gap-1 px-1 py-1">
              <ThemeToggle label={t('themeToggle')} />
              <LanguageSelector variant="compact" />
              <span
                aria-label={t('currencyBadgeLabel')}
                className="rounded-[var(--radius-pill)] border border-border px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
              >
                {t('currencyBadge')}
              </span>
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
