'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { resolvePostAuthPathForUser } from '@/lib/auth/post-auth-path'

/**
 * Resolve where a freshly-authenticated User should land, based on their
 * marketplace role profile (ADR-0006) and an optional `returnTo` intent
 * (launch-readiness 02). Roles are NOT on the session — they attach via
 * the profile tables — so this must run server-side after sign-in.
 *
 * SECURITY: this is a client-callable endpoint, so `rawReturnTo` is
 * attacker-controlled regardless of what the sign-in page passed. All
 * validation lives in the db-injected core (lib/auth/post-auth-path),
 * which sanitizes via lib/auth/return-to before use — an unsafe value
 * silently falls back to role-based routing.
 */
export async function resolvePostAuthPath(rawReturnTo?: string): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  return resolvePostAuthPathForUser(db, session?.user?.id ?? null, rawReturnTo)
}
