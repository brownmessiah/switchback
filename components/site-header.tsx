import { headers } from 'next/headers'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { auth } from '@/lib/auth'

import { UserMenu } from './user-menu'

interface SiteHeaderProps {
  lng?: string
}

export async function SiteHeader({ lng = 'en' }: SiteHeaderProps): Promise<ReactElement> {
  const prefix = lng === 'en' ? '' : `/${lng}`

  let user: { name: string; email: string; image?: string | null } | null = null
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user) {
      user = {
        name: session.user.name ?? session.user.email ?? 'User',
        email: session.user.email ?? '',
        image: session.user.image ?? null,
      }
    }
  } catch {
    // No session — show sign-in link
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href={`${prefix}/`}
          className="text-lg font-semibold tracking-tight"
          aria-label="Outvers home"
        >
          Outvers
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
          <Link
            href={`${prefix}/search`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Search
          </Link>
          <Link
            href={`${prefix}/adventure/rafting-in-rishikesh`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Adventures
          </Link>
          <Link
            href={`${prefix}/cancellation-policy`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Refund policy
          </Link>
          {user ? (
            <UserMenu user={user} prefix={prefix} />
          ) : (
            <Link
              href={`${prefix}/sign-in`}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
          )}
        </nav>

        <details className="sm:hidden">
          <summary
            className="cursor-pointer list-none rounded-md p-2 text-muted-foreground"
            aria-label="Open menu"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
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
              href={`${prefix}/search`}
              className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Search
            </Link>
            <Link
              href={`${prefix}/adventure/rafting-in-rishikesh`}
              className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Adventures
            </Link>
            <Link
              href={`${prefix}/cancellation-policy`}
              className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Refund policy
            </Link>
            {user ? (
              <>
                <div className="my-1 border-t border-border" />
                <span className="px-3 py-1 text-xs text-muted-foreground">{user.name}</span>
                <Link href="/dashboard" className="rounded px-3 py-2 text-sm hover:bg-accent">
                  My bookings
                </Link>
              </>
            ) : (
              <Link
                href={`${prefix}/sign-in`}
                className="rounded px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Sign in
              </Link>
            )}
          </nav>
        </details>
      </div>
    </header>
  )
}
