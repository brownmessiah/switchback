import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import type { VendorEmailInput, VendorEmailSender } from './vendor-lifecycle'
import {
  notifyVendorApplicationReceived,
  notifyVendorKycDecision,
} from './vendor-notifications'

/**
 * The wiring layer between "something happened to this Vendor" and the email
 * content. It resolves the recipient from the database, because callers only
 * hold a `vendorUserId`.
 *
 * Every function here is best-effort: onboarding and KYC decisions have
 * already committed by the time we send, so a missing address or a dead
 * provider must never surface as a failure to the Vendor or the admin.
 */

function recordingSender(): {
  sender: VendorEmailSender
  sent: VendorEmailInput[]
} {
  const sent: VendorEmailInput[] = []
  return {
    sent,
    sender: {
      async send(input) {
        sent.push(input)
        return { ok: true, id: 'test-1' }
      },
    },
  }
}

async function seedVendor(
  db: TestDB,
  userId: string,
  email: string | null,
): Promise<void> {
  await db.insert(users).values({ id: userId, email: email ?? `${userId}@placeholder.test` })
  if (email === null) {
    await db.execute(sql`UPDATE users SET email = NULL WHERE id = ${userId}`)
  }
  await db.insert(vendorProfiles).values({
    userId,
    businessName: 'Himalayan Rafting Co.',
    slug: `slug-${userId}`,
    kycTier: 'phone',
  })
}

describe('vendor email notifications', () => {
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
    await db.execute(sql`TRUNCATE TABLE vendor_profiles, users CASCADE`)
  })

  it('emails a newly-onboarded Vendor at their account address', async () => {
    await seedVendor(db, 'v1', 'vendor@example.test')
    const { sender, sent } = recordingSender()

    await notifyVendorApplicationReceived(db, sender, 'v1')

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('vendor@example.test')
    expect(sent[0]?.subject).toMatch(/Himalayan Rafting Co\./)
  })

  it('emails the approval outcome, including what went live', async () => {
    await seedVendor(db, 'v1', 'vendor@example.test')
    const { sender, sent } = recordingSender()

    await notifyVendorKycDecision(db, sender, 'v1', {
      decision: 'approved',
      tier: 'identity',
      publishedCount: 3,
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toMatch(/3 listings are now live/i)
  })

  it('emails the rejection reason', async () => {
    await seedVendor(db, 'v1', 'vendor@example.test')
    const { sender, sent } = recordingSender()

    await notifyVendorKycDecision(db, sender, 'v1', {
      decision: 'rejected',
      reason: 'PAN does not match the submitted name.',
    })

    expect(sent[0]?.text).toMatch(/PAN does not match the submitted name\./)
  })

  it('sends nothing when the Vendor has no email address', async () => {
    await seedVendor(db, 'v1', null)
    const { sender, sent } = recordingSender()

    await notifyVendorApplicationReceived(db, sender, 'v1')

    expect(sent).toHaveLength(0)
  })

  it('sends nothing for an unknown Vendor', async () => {
    const { sender, sent } = recordingSender()

    await notifyVendorApplicationReceived(db, sender, 'does-not-exist')

    expect(sent).toHaveLength(0)
  })

  it('never throws when the provider fails — the decision already committed', async () => {
    await seedVendor(db, 'v1', 'vendor@example.test')
    const exploding: VendorEmailSender = {
      async send() {
        throw new Error('provider down')
      },
    }

    await expect(
      notifyVendorKycDecision(db, exploding, 'v1', {
        decision: 'approved',
        tier: 'identity',
        publishedCount: 1,
      }),
    ).resolves.toBeUndefined()
  })
})
