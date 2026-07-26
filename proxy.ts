/**
 * Next.js proxy (formerly middleware) — applies next-intl locale rewriting
 * to public marketing routes only. Admin, vendor dashboard, customer
 * dashboard, and API routes pass through unmodified.
 *
 * Per ADR-0012 + ADR-0013: en is un-prefixed (canonical), other locales
 * get a /{locale}/ path prefix.
 */

import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { routing, shouldExcludeFromI18n } from '@/lib/i18n/routing'

const intlMiddleware = createMiddleware(routing)

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Skip i18n rewriting for excluded routes (admin, vendor dashboard,
  // customer dashboard, API). Stamp the requested path so auth-gate
  // layouts (which cannot see the URL) can carry it through sign-in as
  // `returnTo` (launch-readiness 02). `.set` overwrites any inbound
  // client value; consumers still sanitize before use.
  if (shouldExcludeFromI18n(pathname)) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-request-path', pathname + request.nextUrl.search)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  return intlMiddleware(request)
}

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|xml|txt|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
}
