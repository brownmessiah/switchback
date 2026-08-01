import { NextResponse } from 'next/server'

import { resolvePostAuthPath } from '@/app/[locale]/(marketing)/sign-in/actions'
import { env } from '@/lib/env'

/**
 * Where an OAuth sign-in lands.
 *
 * The email flow can call `resolvePostAuthPath()` inline and navigate, but
 * OAuth leaves the app entirely and comes back to a fixed `callbackURL`. This
 * route is that fixed address: it resolves the same role-aware destination
 * (Admin → allowlisted `next` → Vendor → Customer) and redirects.
 *
 * Lives under `/api/` for two reasons: it is outside the i18n rewrite (so it
 * is not locale-prefixed and does not need an EXCLUDED_PREFIXES entry), and it
 * avoids `/api/auth/*`, which better-auth owns via its catch-all handler.
 *
 * `next` is untrusted — it round-tripped through Google — and is re-validated
 * by resolvePostAuthPath's allowlist, not trusted because we set it.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const next = new URL(request.url).searchParams.get('next') ?? undefined
  const destination = await resolvePostAuthPath(next)

  // Resolve against the app's own origin so the Location header can never be
  // pointed off-site by a crafted `next`.
  return NextResponse.redirect(new URL(destination, env.NEXT_PUBLIC_APP_URL))
}
