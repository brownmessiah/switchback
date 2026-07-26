import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { accounts } from '@/db/schema/auth'
import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { convertSeedAdminToRealAccount } from './admin-conversion'
import { SEED_ADMIN_USER_ID } from './seed-data-registry'

/**
 * Admin conversion (launch-readiness 07).
 *
 * Three failure modes drive this suite, and none of them are caught by
 * the obvious "did the new password work?" assertion:
 *
 *  1. `accounts(user_id, provider_id)` has NO unique constraint
 *     (0000_big_fenris.sql:305-306 creates plain indexes). A naive
 *     INSERT leaves TWO credential rows and better-auth's sign-in does
 *     `user.accounts.find(a => a.providerId === 'credential')` — so the
 *     OLD password can keep working while a new-password test passes.
 *     Hence: assert the ROW COUNT, once and again after a second run.
 *  2. better-auth looks users up via `email.toLowerCase()` against a
 *     plain unique text column with no `lower()` index. A mixed-case
 *     write is a silent, total lockout with a correct-looking row.
 *  3. The password is an argument. It must never reach an error message.
 */

const SEED_ADMIN_EMAIL = 'admin@seed.outvers.dev'
const REAL_ADMIN_EMAIL = 'aishwarye@outvers.com'
/** Matches db/seed-demo-passwords.ts — the credential being retired. */
const OLD_PASSWORD = 'OutversDemo!2026'
const NEW_PASSWORD = 'k4V!7pZq-x2Rt9Wm'
const SEED_ADMIN_NAME = 'Outvers Editorial'

async function hash(password: string): Promise<string> {
  const ctx = await auth.$context
  return ctx.password.hash(password)
}

async function verifies(hashed: string, password: string): Promise<boolean> {
  const ctx = await auth.$context
  return ctx.password.verify({ hash: hashed, password })
}

async function credentialRows(db: TestDB, userId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
}

async function adminRow(db: TestDB, userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return row
}

describe('convertSeedAdminToRealAccount', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let oldHash: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    oldHash = await hash(OLD_PASSWORD)
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.delete(blogPosts)
    await db.delete(accounts)
    await db.delete(adminProfiles)
    await db.delete(users)

    await db.insert(users).values({
      id: SEED_ADMIN_USER_ID,
      email: SEED_ADMIN_EMAIL,
      name: SEED_ADMIN_NAME,
    })
    await db.insert(adminProfiles).values({
      userId: SEED_ADMIN_USER_ID,
      permissions: ['*'],
    })
    await db.insert(accounts).values({
      id: randomUUID(),
      userId: SEED_ADMIN_USER_ID,
      providerId: 'credential',
      accountId: SEED_ADMIN_USER_ID,
      password: oldHash,
    })
    await db.insert(blogPosts).values({
      title: 'Rishikesh rafting, month by month',
      slug: 'rishikesh-rafting-month-by-month',
      content: '# Rafting',
      category: 'guides',
      status: 'published',
      publishedAt: new Date(),
      authorAdminId: SEED_ADMIN_USER_ID,
    })
  })

  // ── Identity is preserved ─────────────────────────────────────────
  it('rewrites the email while preserving the user id', async () => {
    const result = await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    expect(result.userId).toBe(SEED_ADMIN_USER_ID)
    const row = await adminRow(db, SEED_ADMIN_USER_ID)
    expect(row).toBeDefined()
    expect(row!.email).toBe(REAL_ADMIN_EMAIL)
  })

  it('leaves admin permissions at ["*"]', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const [profile] = await db
      .select()
      .from(adminProfiles)
      .where(eq(adminProfiles.userId, SEED_ADMIN_USER_ID))
    expect(profile!.permissions).toEqual(['*'])
  })

  it('keeps blog authorship resolving to the same admin', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const joined = await db
      .select({ slug: blogPosts.slug, authorEmail: users.email, authorName: users.name })
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorAdminId, users.id))

    expect(joined).toHaveLength(1)
    expect(joined[0]!.authorEmail).toBe(REAL_ADMIN_EMAIL)
    // The byline is users.name — conversion must not silently rewrite it.
    expect(joined[0]!.authorName).toBe(SEED_ADMIN_NAME)
  })

  it('updates the byline only when a name is explicitly supplied', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
      name: 'Outvers Team',
    })

    const row = await adminRow(db, SEED_ADMIN_USER_ID)
    expect(row!.name).toBe('Outvers Team')
  })

  // ── The credential row ────────────────────────────────────────────
  it('leaves exactly ONE credential row after conversion', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    expect(await credentialRows(db, SEED_ADMIN_USER_ID)).toHaveLength(1)
  })

  it('leaves exactly ONE credential row after running twice', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    expect(await credentialRows(db, SEED_ADMIN_USER_ID)).toHaveLength(1)
  })

  it('collapses pre-existing duplicate credential rows down to one', async () => {
    await db.insert(accounts).values({
      id: randomUUID(),
      userId: SEED_ADMIN_USER_ID,
      providerId: 'credential',
      accountId: SEED_ADMIN_USER_ID,
      password: oldHash,
    })
    expect(await credentialRows(db, SEED_ADMIN_USER_ID)).toHaveLength(2)

    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const rows = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(rows).toHaveLength(1)
    expect(await verifies(rows[0]!.password!, OLD_PASSWORD)).toBe(false)
  })

  it('creates the credential row when the admin has none', async () => {
    await db.delete(accounts)

    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const rows = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(rows).toHaveLength(1)
    expect(await verifies(rows[0]!.password!, NEW_PASSWORD)).toBe(true)
  })

  it('leaves non-credential accounts (OAuth links) untouched', async () => {
    await db.insert(accounts).values({
      id: randomUUID(),
      userId: SEED_ADMIN_USER_ID,
      providerId: 'google',
      accountId: 'google-sub-123',
    })

    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const [google] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, SEED_ADMIN_USER_ID), eq(accounts.providerId, 'google')))
    expect(google).toBeDefined()
    expect(google!.accountId).toBe('google-sub-123')
  })

  // ── Authentication actually changes hands ─────────────────────────
  it('makes the NEW password verify through better-auth', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const [row] = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(await verifies(row!.password!, NEW_PASSWORD)).toBe(true)
  })

  it('stops the OLD seeded password verifying', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    const [row] = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(await verifies(row!.password!, OLD_PASSWORD)).toBe(false)
  })

  // ── Idempotency ───────────────────────────────────────────────────
  it('is idempotent — the second run finds the already-converted admin', async () => {
    const first = await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })
    const second = await convertSeedAdminToRealAccount(db, {
      fromEmail: SEED_ADMIN_EMAIL,
      toEmail: REAL_ADMIN_EMAIL,
      password: NEW_PASSWORD,
    })

    expect(second.userId).toBe(first.userId)
    expect(second.emailAction).toBe('already-converted')
    const [row] = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(await verifies(row!.password!, NEW_PASSWORD)).toBe(true)
  })

  // ── The silent-lockout case ───────────────────────────────────────
  it('lowercases a mixed-case target email before writing', async () => {
    await convertSeedAdminToRealAccount(db, {
      fromEmail: 'Admin@Seed.Outvers.DEV',
      toEmail: 'Aishwarye@Outvers.COM',
      password: NEW_PASSWORD,
    })

    const row = await adminRow(db, SEED_ADMIN_USER_ID)
    expect(row!.email).toBe('aishwarye@outvers.com')
  })

  // ── Refusals, with no partial writes ──────────────────────────────
  it('fails cleanly on an unknown fromEmail, writing nothing', async () => {
    await expect(
      convertSeedAdminToRealAccount(db, {
        fromEmail: 'nobody@seed.outvers.dev',
        toEmail: REAL_ADMIN_EMAIL,
        password: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/no user/i)

    const row = await adminRow(db, SEED_ADMIN_USER_ID)
    expect(row!.email).toBe(SEED_ADMIN_EMAIL)
    const rows = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(rows).toHaveLength(1)
    expect(await verifies(rows[0]!.password!, OLD_PASSWORD)).toBe(true)
  })

  it('never puts the password in a thrown error', async () => {
    let thrown: unknown
    try {
      await convertSeedAdminToRealAccount(db, {
        fromEmail: 'nobody@seed.outvers.dev',
        toEmail: REAL_ADMIN_EMAIL,
        password: NEW_PASSWORD,
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const error = thrown as Error
    expect(error.message).not.toContain(NEW_PASSWORD)
    expect(error.stack ?? '').not.toContain(NEW_PASSWORD)
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(NEW_PASSWORD)
  })

  it('refuses a target email still inside the seed domain', async () => {
    // A seed-domain target would put the converted Admin straight back
    // into the purge predicate — the very row the purge must spare.
    await expect(
      convertSeedAdminToRealAccount(db, {
        fromEmail: SEED_ADMIN_EMAIL,
        toEmail: 'newadmin@seed.outvers.dev',
        password: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/seed/i)

    const row = await adminRow(db, SEED_ADMIN_USER_ID)
    expect(row!.email).toBe(SEED_ADMIN_EMAIL)
  })

  it('refuses to convert a User that holds no admin profile', async () => {
    await db.insert(users).values({
      id: 'u_seed_customer',
      email: 'customer@seed.outvers.dev',
      name: 'Seed Customer',
    })

    await expect(
      convertSeedAdminToRealAccount(db, {
        fromEmail: 'customer@seed.outvers.dev',
        toEmail: REAL_ADMIN_EMAIL,
        password: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/admin/i)

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, 'u_seed_customer'))
      .limit(1)
    expect(row!.email).toBe('customer@seed.outvers.dev')
  })

  it('refuses when another User already holds the target email', async () => {
    await db.insert(users).values({
      id: 'u_real_someone',
      email: REAL_ADMIN_EMAIL,
      name: 'Someone Else',
    })

    await expect(
      convertSeedAdminToRealAccount(db, {
        fromEmail: SEED_ADMIN_EMAIL,
        toEmail: REAL_ADMIN_EMAIL,
        password: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/already/i)

    const row = await adminRow(db, SEED_ADMIN_USER_ID)
    expect(row!.email).toBe(SEED_ADMIN_EMAIL)
  })

  it('refuses an empty password rather than writing an unusable hash', async () => {
    await expect(
      convertSeedAdminToRealAccount(db, {
        fromEmail: SEED_ADMIN_EMAIL,
        toEmail: REAL_ADMIN_EMAIL,
        password: '   ',
      }),
    ).rejects.toThrow(/password/i)

    const rows = await credentialRows(db, SEED_ADMIN_USER_ID)
    expect(await verifies(rows[0]!.password!, OLD_PASSWORD)).toBe(true)
  })
})
