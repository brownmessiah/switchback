'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'

import { AuthStatus } from './auth-status'
import { LanguageSelector } from './language-selector'

export function SiteHeader(): ReactElement {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const t = useTranslations('Nav')

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
          <Link
            href="/search"
            className={
              isHome
                ? 'text-sm text-white/80 hover:text-white'
                : 'text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t('search')}
          </Link>
          <Link
            href="/adventure/rafting-in-rishikesh"
            className={
              isHome
                ? 'text-sm text-white/80 hover:text-white'
                : 'text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t('adventures')}
          </Link>
          <Link
            href="/cancellation-policy"
            className={
              isHome
                ? 'text-sm text-white/80 hover:text-white'
                : 'text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t('refundPolicy')}
          </Link>
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
            className="absolute right-4 mt-2 flex w-48 flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg"
          >
            <Link
              href="/search"
              className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t('search')}
            </Link>
            <Link
              href="/adventure/rafting-in-rishikesh"
              className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t('adventures')}
            </Link>
            <Link
              href="/cancellation-policy"
              className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t('refundPolicy')}
            </Link>
            <div className="px-1 py-1">
              <LanguageSelector variant="compact" />
            </div>
            <Link
              href="/sign-in"
              className="rounded px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              {t('signIn')}
            </Link>
          </nav>
        </details>
      </div>
    </header>
  )
}
