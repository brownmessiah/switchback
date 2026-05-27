/**
 * Auth session injection for E2E tests.
 *
 * Inserts a better-auth session row directly into the `sessions` table
 * for one of the seed users, then writes a Playwright-compatible storage
 * state JSON file containing the session cookie.
 *
 * The session cookie name is `better-auth.session_token` (set by
 * better-auth + nextCookies plugin).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import postgres from 'postgres'

type Role = 'customer' | 'vendor' | 'admin'

/** Seed user IDs — must match db/seed.ts */
const SEED_USERS: Record<Role, string> = {
  admin: 'u_seed_admin',
  customer: 'u_seed_customer',
  vendor: 'u_seed_v_business',
}

const AUTH_DIR = path.resolve(__dirname, '../.auth')

/**
 * Cookie name used by better-auth's nextCookies() plugin.
 * In development (non-HTTPS) it drops the `__Secure-` prefix.
 */
const SESSION_COOKIE_NAME = 'better-auth.session_token'

/**
 * Derives the E2E database URL from `DATABASE_URL` by replacing the
 * database name component with `outvers_e2e`.
 */
function e2eDbUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL env var is required')
  // Replace the last path segment (database name) with outvers_e2e
  return base.replace(/\/[^/?]+(\?|$)/, '/outvers_e2e$1')
}

/**
 * Injects a session for the given role's seed user.
 *
 * 1. Inserts a row into the `sessions` table with a fresh token.
 * 2. Writes a Playwright storage state JSON to `.auth/<role>-storage.json`.
 *
 * Returns the path to the storage state file.
 */
export async function injectSession(role: Role): Promise<string> {
  const userId = SEED_USERS[role]
  const sessionId = `e2e_session_${role}_${crypto.randomUUID()}`
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // +24h

  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    await sql`
      INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
      VALUES (
        ${sessionId},
        ${userId},
        ${token},
        ${expiresAt.toISOString()},
        ${'127.0.0.1'},
        ${'Playwright E2E'},
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `
  } finally {
    await sql.end()
  }

  // Ensure .auth directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
  }

  // Derive the base URL for the cookie domain
  const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const url = new URL(baseURL)

  const storagePath = path.join(AUTH_DIR, `${role}-storage.json`)

  const storageState = {
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: token,
        domain: url.hostname,
        path: '/',
        expires: Math.floor(expiresAt.getTime() / 1000),
        httpOnly: true,
        secure: url.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  }

  fs.writeFileSync(storagePath, JSON.stringify(storageState, null, 2))

  return storagePath
}
