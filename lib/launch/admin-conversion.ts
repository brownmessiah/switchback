/**
 * Admin account conversion (launch-readiness 07).
 *
 * Turns the seeded Admin — `admin@seed.outvers.dev`, protected by a
 * password hardcoded at `db/seed-demo-passwords.ts:11` — into a real
 * account, IN PLACE. The user id never changes, so blog authorship
 * (`blog_posts.author_admin_id` is a RESTRICT FK), the `admin_profiles`
 * row and its `permissions: ['*']` all survive untouched. Delete and
 * recreate would open a lockout window and force a blog reassignment.
 *
 * ── Why not the better-auth API ─────────────────────────────────────
 * `auth.api.setPassword` throws PASSWORD_ALREADY_SET and needs a live
 * session; `changePassword` needs a session plus the current password;
 * `changeEmail` needs `user.changeEmail.enabled`, which
 * `lib/auth/index.ts` does not set. All three are unavailable to an
 * operator script. So this module writes the rows directly — but hashes
 * with better-auth's OWN hasher (`auth.$context.password.hash`, the
 * pattern at `db/seed-demo-passwords.ts:33-58`), which is what makes the
 * result verify through the ordinary sign-in path.
 *
 * ── Why UPDATE, never INSERT ────────────────────────────────────────
 * There is NO unique constraint on `accounts(user_id, provider_id)` —
 * `db/migrations/0000_big_fenris.sql:305-306` creates plain indexes. An
 * INSERT therefore leaves TWO credential rows, and better-auth's sign-in
 * takes `user.accounts.find(a => a.providerId === 'credential')`
 * (`node_modules/better-auth/dist/api/routes/sign-in.mjs:210`) — whichever
 * row the adapter returns first. The retired password can keep working
 * while a new-password check also passes. This module selects the
 * existing credential row and UPDATEs it, deleting any duplicates it
 * finds, and only INSERTs when none exists.
 *
 * ── Why the email is lowercased ─────────────────────────────────────
 * `findUserByEmail` queries `email.toLowerCase()`
 * (`node_modules/better-auth/dist/db/internal-adapter.mjs:466`) against a
 * plain unique text column with no `lower()` index. A mixed-case write
 * is a silent, total lockout behind a correct-looking row.
 *
 * ── `users.name` is the public blog byline ──────────────────────────
 * `blog_posts.author_admin_id → users.name` renders on every published
 * post, so conversion LEAVES IT ALONE by default and takes an optional
 * explicit `name` when the operator actually intends the byline on the
 * live corpus to change. Silently rewriting it would edit 40 published
 * posts as a side effect of a credential rotation.
 *
 * ── The sub-admin is NOT removed here ───────────────────────────────
 * RECON §G corrected the sequencing the issue assumed: `u_seed_subadmin`
 * is an ordinary seed User carrying an `@seed.outvers.dev` address, so it
 * dies inside the purge (slice 06) with the rest of the seed data. The
 * order is convert → build the plan → approve → purge, which also moves
 * the real Admin out of the seed predicate before the plan is computed.
 *
 * The password is an ARGUMENT. It is never read from disk, never logged,
 * and never embedded in an error message.
 *
 * Deployment note (RECON §F1): this module imports `@/lib/auth`, which
 * imports `@/lib/env` and therefore needs `BETTER_AUTH_SECRET` and
 * `NEXT_PUBLIC_APP_URL` present — the `outvers-migrate` Cloud Run Job is
 * given only `DATABASE_URL` today. Slice 08 owns that wiring.
 */

import { randomUUID } from 'node:crypto'

import { and, eq, ne, sql } from 'drizzle-orm'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { accounts } from '@/db/schema/auth'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { isSeedEmail, SEED_EMAIL_DOMAIN } from './seed-data-registry'

export interface ConvertSeedAdminInput {
  /** Current address of the seeded Admin, e.g. `admin@seed.outvers.dev`. */
  fromEmail: string
  /** The real address to move it to. Lowercased before it is written. */
  toEmail: string
  /** Supplied by the caller from the environment. Never persisted in clear. */
  password: string
  /** Optional new public blog byline. Omit to leave `users.name` as-is. */
  name?: string
}

export interface AdminConversionResult {
  /** Unchanged by conversion — this is the whole point of the module. */
  userId: string
  /** The stored (lowercased) email after conversion. */
  email: string
  credentialAccountId: string
  credentialAction: 'updated' | 'created'
  emailAction: 'rewritten' | 'already-converted'
  /** Duplicate credential rows removed, if the account had drifted. */
  duplicateCredentialsRemoved: number
}

/** better-auth's own floor (`emailAndPassword.minPasswordLength` default). */
const MIN_PASSWORD_LENGTH = 8

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Convert the seeded Admin into a real account: rewrite `users.email`
 * and replace the better-auth credential, preserving the user id.
 *
 * Idempotent — a second run with the same `toEmail` finds the
 * already-converted Admin and simply re-applies the credential. Every
 * refusal happens BEFORE the first write, and the two writes share one
 * transaction, so a failed conversion leaves the database untouched.
 */
export async function convertSeedAdminToRealAccount(
  db: DBOrTx,
  input: ConvertSeedAdminInput,
): Promise<AdminConversionResult> {
  const fromEmail = normaliseEmail(input.fromEmail)
  const toEmail = normaliseEmail(input.toEmail)

  // ── Argument guards. None of these mention the password's value. ──
  if (input.password.trim().length === 0) {
    throw new Error('Refusing to convert: the password argument is empty.')
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Refusing to convert: the password is shorter than ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }
  if (toEmail.length === 0 || !toEmail.includes('@')) {
    throw new Error('Refusing to convert: the target email is not an email address.')
  }
  if (isSeedEmail(toEmail)) {
    throw new Error(
      `Refusing to convert: the target email is still inside the seed domain ` +
        `(${SEED_EMAIL_DOMAIN}), which would put the Admin back into the purge predicate.`,
    )
  }

  // ── Locate the Admin. Already-converted is a success, not a fault. ─
  const target = await findUserByEmail(db, fromEmail)
  const converted = target ?? (await findUserByEmail(db, toEmail))
  if (!converted) {
    throw new Error(
      `Refusing to convert: no User found with email "${fromEmail}" or "${toEmail}".`,
    )
  }

  const [profile] = await db
    .select({ userId: adminProfiles.userId })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, converted.id))
    .limit(1)
  if (!profile) {
    throw new Error(
      `Refusing to convert: User "${converted.id}" holds no admin profile, so it is not the seeded Admin.`,
    )
  }

  const conflict = await findUserByEmail(db, toEmail)
  if (conflict && conflict.id !== converted.id) {
    throw new Error(
      `Refusing to convert: email "${toEmail}" is already held by User "${conflict.id}".`,
    )
  }

  const ctx = await auth.$context
  const hashed = await ctx.password.hash(input.password)
  const now = new Date()

  return db.transaction(async (tx) => {
    const emailAction: AdminConversionResult['emailAction'] =
      converted.email === toEmail ? 'already-converted' : 'rewritten'

    await tx
      .update(users)
      .set({
        email: toEmail,
        ...(input.name === undefined ? {} : { name: input.name }),
        updatedAt: now,
      })
      .where(eq(users.id, converted.id))

    const credentials = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, converted.id), eq(accounts.providerId, 'credential')))
      .orderBy(accounts.createdAt, accounts.id)

    const [keep, ...duplicates] = credentials

    if (keep) {
      await tx
        .update(accounts)
        .set({ password: hashed, updatedAt: now })
        .where(eq(accounts.id, keep.id))

      // A duplicate credential row is a live authentication hazard: the
      // sign-in path picks whichever the adapter returns first, so a
      // stale row can keep the retired password working.
      if (duplicates.length > 0) {
        await tx
          .delete(accounts)
          .where(
            and(
              eq(accounts.userId, converted.id),
              eq(accounts.providerId, 'credential'),
              ne(accounts.id, keep.id),
            ),
          )
      }

      return {
        userId: converted.id,
        email: toEmail,
        credentialAccountId: keep.id,
        credentialAction: 'updated' as const,
        emailAction,
        duplicateCredentialsRemoved: duplicates.length,
      }
    }

    const credentialAccountId = randomUUID()
    await tx.insert(accounts).values({
      id: credentialAccountId,
      userId: converted.id,
      providerId: 'credential',
      accountId: converted.id,
      password: hashed,
    })

    return {
      userId: converted.id,
      email: toEmail,
      credentialAccountId,
      credentialAction: 'created' as const,
      emailAction,
      duplicateCredentialsRemoved: 0,
    }
  })
}

/** Case-insensitive lookup — the stored column has no `lower()` index. */
async function findUserByEmail(
  db: DBOrTx,
  email: string,
): Promise<{ id: string; email: string | null } | undefined> {
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1)
  return row
}
