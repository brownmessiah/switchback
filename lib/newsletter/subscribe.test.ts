import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { newsletterSubscribers } from '@/db/schema'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { subscribeNewsletter } from './subscribe'

// ---------------------------------------------------------------------------
// subscribeNewsletter — the testable DB core (PGlite)
//
// Asserts EXTERNAL behaviour through the public interface only: the returned
// discriminated result + what landed in the newsletter_subscribers table. The
// four issue-mandated outcomes are covered: success / already-subscribed /
// invalid / error.
// ---------------------------------------------------------------------------
describe('subscribeNewsletter', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE newsletter_subscribers CASCADE`)
  })

  it('valid new email → success and exactly one row persisted (stored lowercased)', async () => {
    const result = await subscribeNewsletter(db, 'Visitor@Example.com', {
      source: 'footer',
      locale: 'en',
    })
    expect(result.status).toBe('success')

    const rows = await db.select().from(newsletterSubscribers)
    expect(rows).toHaveLength(1)
    // Email is normalized to lowercase + trimmed on the way in.
    expect(rows[0].email).toBe('visitor@example.com')
    expect(rows[0].source).toBe('footer')
    expect(rows[0].locale).toBe('en')
  })

  it('duplicate email (different case + surrounding whitespace) → already-subscribed and no second row', async () => {
    const first = await subscribeNewsletter(db, 'a@b.com')
    expect(first.status).toBe('success')

    // Same address, but uppercased and whitespace-padded — must de-dupe.
    const second = await subscribeNewsletter(db, '  A@B.COM  ')
    expect(second.status).toBe('already-subscribed')

    const rows = await db.select().from(newsletterSubscribers)
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('a@b.com')
  })

  it('malformed email → invalid and nothing persisted', async () => {
    const result = await subscribeNewsletter(db, 'not-an-email')
    expect(result.status).toBe('invalid')

    const rows = await db.select().from(newsletterSubscribers)
    expect(rows).toHaveLength(0)
  })

  it('persistence failure → error (no unhandled throw reaches the caller)', async () => {
    // A db stub whose .insert() throws — the one place a throwing stub is the
    // right tool. Proves the try/catch converts a DB fault into a typed result.
    const brokenDb = {
      insert: () => {
        throw new Error('db down')
      },
    } as unknown as TestDB

    const result = await subscribeNewsletter(brokenDb, 'valid@example.com')
    expect(result.status).toBe('error')
  })
})
