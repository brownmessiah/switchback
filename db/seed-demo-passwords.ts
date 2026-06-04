import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { auth } from '@/lib/auth'

import { accounts } from './schema'
import type { SeedDb } from './seed-extras'

/** The shared demo password for the role accounts the owner signs in as. */
export const DEMO_PASSWORD = 'OutversDemo!2026'

/** Seed user ids that get an email/password credential for the live demo. */
const DEMO_LOGIN_USER_IDS = [
  'u_seed_admin',
  'u_seed_subadmin',
  'u_seed_customer',
  'u_seed_v_phone',
  'u_seed_v_identity',
  'u_seed_v_business',
] as const

/**
 * Seed email/password credentials for the demo role accounts so the owner can
 * sign in via the UI. The E2E suite injects sessions directly, so these users
 * otherwise have NO password — UI login fails with "invalid email or password".
 *
 * Idempotent: upserts the better-auth `credential` account row, hashing the
 * password with better-auth's OWN hasher (`auth.$context.password.hash`) so the
 * sign-in flow verifies it. Demo/dev convenience only — real users set their
 * own passwords; this never runs against real accounts.
 */
export async function seedDemoPasswords(db: SeedDb): Promise<void> {
  const ctx = await auth.$context
  const hashed = await ctx.password.hash(DEMO_PASSWORD)

  for (const userId of DEMO_LOGIN_USER_IDS) {
    const [existing] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
      .limit(1)

    if (existing) {
      await db
        .update(accounts)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(accounts.id, existing.id))
    } else {
      await db.insert(accounts).values({
        id: randomUUID(),
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hashed,
      })
    }
  }
}
