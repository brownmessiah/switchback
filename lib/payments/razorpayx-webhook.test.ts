import { createHmac } from 'node:crypto'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { notifications } from '@/db/schema/notifications'
import { payouts } from '@/db/schema/payouts'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { _resetRedisCacheForTests, getRedis } from '@/lib/redis'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  processRazorpayXWebhook,
  type RazorpayXWebhookResult,
} from './razorpayx-webhook'

/**
 * Razorpay X payout webhook handler (slice 06) — the idempotency-critical
 * entry point for `payout.processed`.
 *
 * The X trust boundary is DISTINCT from the PG one: its own endpoint, its own
 * secret (RAZORPAYX_WEBHOOK_SECRET), and a SEPARATE Redis dedup namespace
 * (`razorpayx-event:`) so a PG event id and an X event id can never collide.
 *
 * Layered idempotency per ADR-0016 (2026-06-18 amendment D4):
 *   1. Redis dedup on the event id, 14-day TTL — fast path.
 *   2. DB-level guard: the status UPDATE is conditioned on `status <> 'paid'`
 *      so a replay that slips past Redis is a no-op (paid → paid) and skips
 *      the audit + notify side-effects.
 *
 * 1000x replay must produce exactly ONE status transition + ONE audit row +
 * ONE notification per member Booking.
 */
const X_WEBHOOK_SECRET = 'whsec_test_outvers_x'

function sign(body: string): string {
  return createHmac('sha256', X_WEBHOOK_SECRET).update(body).digest('hex')
}

function buildPayoutProcessedBody(args: {
  eventId: string
  payoutEntityId: string
  referenceId: string | null
  amountPaise: number
  notes?: Record<string, unknown>
}): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: 'payout.processed',
    contains: ['payout'],
    payload: {
      payout: {
        entity: {
          id: args.payoutEntityId,
          entity: 'payout',
          amount: args.amountPaise,
          currency: 'INR',
          status: 'processed',
          reference_id: args.referenceId,
          notes: args.notes ?? {},
          created_at: 1_700_000_000,
        },
      },
    },
    created_at: 1_700_000_000,
    id: args.eventId,
  })
}

/** Build a generic payout lifecycle event body (e.g. payout.failed / payout.reversed). */
function buildPayoutEventBody(args: {
  event: string
  eventId: string
  payoutEntityId: string
  referenceId: string | null
  amountPaise: number
  status?: string
  notes?: Record<string, unknown>
  statusDetails?: Record<string, unknown>
}): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: args.event,
    contains: ['payout'],
    payload: {
      payout: {
        entity: {
          id: args.payoutEntityId,
          entity: 'payout',
          amount: args.amountPaise,
          currency: 'INR',
          status: args.status ?? args.event.split('.')[1],
          reference_id: args.referenceId,
          notes: args.notes ?? {},
          status_details: args.statusDetails,
          created_at: 1_700_000_000,
        },
      },
    },
    created_at: 1_700_000_000,
    id: args.eventId,
  })
}

describe('processRazorpayXWebhook (ADR-0016 D4 — payout.processed)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let slotId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Payout Webhook Vendor',
      slug: 'payout-webhook',
      kycTier: 'identity',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'payout-webhook-exp',
        title: 'Payout Webhook Exp',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2200.00',
        pricePerPerson_6_plus: '2000.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const startAt = new Date(Date.UTC(2026, 0, 1, 6, 0, 0))
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    slotId = slot!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, notification_outbox, notifications, bookings, payouts CASCADE`,
    )
    _resetRedisCacheForTests()
  })

  /** Seed a `processing` Payout Batch + N member Bookings linked to it. */
  async function seedBatch(args: {
    memberCount: number
    amountNetRupees?: string
  }): Promise<{ payoutId: string; bookingIds: string[] }> {
    const [payout] = await db
      .insert(payouts)
      .values({
        vendorUserId: 'u_v',
        destinationFingerprint: 'fp_test',
        razorpayFundAccountId: 'fa_test',
        batchDay: '2026-01-15',
        status: 'processing',
        amountNetRupees: args.amountNetRupees ?? '4000.00',
        tdsTotal: '4.00',
        tcsTotal: '20.00',
        razorpayPayoutId: 'pout_seed',
      })
      .returning({ id: payouts.id })
    const payoutId = payout!.id

    const bookingIds: string[] = []
    for (let i = 0; i < args.memberCount; i++) {
      const [bk] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_c',
          experienceId,
          slotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: '5000.00',
          pricePerParticipantSnapshot: '2500.00',
          pricingBasisSnapshot: 'per_person_1_2',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'gross',
          cancellationPresetSnapshot: 'flexible',
          payoutState: 'processing',
          payoutBatchId: payoutId,
        })
        .returning({ id: bookings.id })
      bookingIds.push(bk!.id)
    }
    return { payoutId, bookingIds }
  }

  async function call(args: {
    body: string
    signature?: string
    eventIdHeader?: string | null
    secret?: string
  }): Promise<RazorpayXWebhookResult> {
    const signature = args.signature ?? sign(args.body)
    return processRazorpayXWebhook({
      db,
      body: args.body,
      signature,
      eventIdHeader: args.eventIdHeader ?? null,
      secret: args.secret ?? X_WEBHOOK_SECRET,
    })
  }

  describe('payout.processed — happy path', () => {
    it('transitions the payouts row to paid, cascades member Bookings to payout_state=paid, writes one audit row', async () => {
      const { payoutId, bookingIds } = await seedBatch({ memberCount: 3 })

      const body = buildPayoutProcessedBody({
        eventId: 'evt_x_1',
        payoutEntityId: 'pout_1',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('paid')

      const memberRows = await db
        .select()
        .from(bookings)
        .where(eq(bookings.payoutBatchId, payoutId))
      expect(memberRows).toHaveLength(3)
      expect(memberRows.every((r) => r.payoutState === 'paid')).toBe(true)
      // sanity — every seeded booking id transitioned
      expect(new Set(memberRows.map((r) => r.id))).toEqual(new Set(bookingIds))

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_processed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]?.entityId).toBe(payoutId)
    })

    it('notifies the Vendor (payout sent) once per member Booking', async () => {
      const { payoutId, bookingIds } = await seedBatch({ memberCount: 2 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_notify_1',
        payoutEntityId: 'pout_notify',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const notifRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'payout_processed'))
      expect(notifRows).toHaveLength(2)
      expect(notifRows.every((r) => r.userId === 'u_v')).toBe(true)
      expect(notifRows.every((r) => r.title.toLowerCase().includes('sent'))).toBe(true)
      // one notification per member booking, keyed by payout_paid:<bookingId>
      expect(new Set(notifRows.map((r) => r.eventId))).toEqual(
        new Set(bookingIds.map((id) => `payout_paid:${id}`)),
      )
    })
  })

  describe('signature / secret policy', () => {
    it('returns 401 on a tampered signature and writes nothing', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_bad_sig',
        payoutEntityId: 'pout_bad_sig',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body, signature: 'a'.repeat(64) })
      expect(result.status).toBe(401)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('processing')
      const auditRows = await db.select().from(auditLogs)
      expect(auditRows).toHaveLength(0)
    })

    it('returns 401 on an empty signature header', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_empty_sig',
        payoutEntityId: 'pout_empty_sig',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body, signature: '' })
      expect(result.status).toBe(401)
    })

    it('returns 500 (not 401) when the secret is missing/empty — operator-correctable', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_no_secret',
        payoutEntityId: 'pout_no_secret',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body, signature: 'whatever', secret: '' })
      expect(result.status).toBe(500)
    })

    it('verifies against the X secret, NOT the PG secret', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_pg_secret',
        payoutEntityId: 'pout_pg_secret',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      // A signature computed with a DIFFERENT (PG) secret must be rejected.
      const pgSecret = 'whsec_test_pg_collection'
      const pgSignature = createHmac('sha256', pgSecret).update(body).digest('hex')
      const rejected = await call({ body, signature: pgSignature })
      expect(rejected.status).toBe(401)

      // The same body signed with the X secret is accepted.
      const accepted = await call({ body })
      expect(accepted.status).toBe(200)
    })
  })

  describe('idempotency — Redis dedup + DB guard', () => {
    it('returns 200 deduped on a duplicate event id (Redis hit), single effect', async () => {
      const { payoutId } = await seedBatch({ memberCount: 2 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_dup',
        payoutEntityId: 'pout_dup',
        referenceId: payoutId,
        amountPaise: 400_000,
      })

      const first = await call({ body })
      expect(first.status).toBe(200)
      expect(first.deduped).toBeFalsy()

      const second = await call({ body })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_processed'))
      expect(auditRows).toHaveLength(1)
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(2)
    })

    it('uses a SEPARATE redis namespace (razorpayx-event:) from the PG handler', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_ns',
        payoutEntityId: 'pout_ns',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const redis = getRedis()
      expect(await redis.get('razorpayx-event:evt_ns')).toBe('1')
      // The PG namespace key must NOT be set by the X handler.
      expect(await redis.get('razorpay-event:evt_ns')).toBeNull()
    })

    it('reads the event id from the X-Razorpay-Event-Id header in preference to body id', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_body_id',
        payoutEntityId: 'pout_hdr',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body, eventIdHeader: 'evt_header_id' })

      const redis = getRedis()
      expect(await redis.get('razorpayx-event:evt_header_id')).toBe('1')
      expect(await redis.get('razorpayx-event:evt_body_id')).toBeNull()
    })

    it('DB guard: a replay past Redis eviction (new event id) is a no-op via status <> paid — ONE audit + ONE notify', async () => {
      const { payoutId } = await seedBatch({ memberCount: 2 })
      const first = await call({
        body: buildPayoutProcessedBody({
          eventId: 'evt_evict_0',
          payoutEntityId: 'pout_evict',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })
      expect(first.status).toBe(200)

      // Simulate Redis eviction: wipe the cache, re-deliver the SAME payout with
      // a different event id. The DB `status <> 'paid'` guard must no-op it.
      _resetRedisCacheForTests()
      const second = await call({
        body: buildPayoutProcessedBody({
          eventId: 'evt_evict_1',
          payoutEntityId: 'pout_evict',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_processed'))
      expect(auditRows).toHaveLength(1)
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(2)
    })

    it('1000x serial replay produces exactly ONE status transition + ONE audit + ONE notify per member booking', async () => {
      const { payoutId } = await seedBatch({ memberCount: 2 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_replay',
        payoutEntityId: 'pout_replay',
        referenceId: payoutId,
        amountPaise: 400_000,
      })

      const results: RazorpayXWebhookResult[] = []
      for (let i = 0; i < 1000; i++) {
        results.push(await call({ body }))
      }
      expect(results.every((r) => r.status === 200)).toBe(true)
      // 999 short-circuit via Redis dedup; 1 real effect.
      expect(results.filter((r) => r.deduped === true)).toHaveLength(999)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('paid')
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_processed'))
      expect(auditRows).toHaveLength(1)
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(2)
    })
  })

  describe('reconciliation', () => {
    it('reconciles by reference_id → payouts.id (primary path)', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_recon_ref',
        payoutEntityId: 'pout_recon_ref',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('paid')
    })

    it('falls back to notes.payout_id when reference_id is absent', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_recon_notes',
        payoutEntityId: 'pout_recon_notes',
        referenceId: null,
        notes: { payout_id: payoutId },
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('paid')
    })

    it('falls back to payouts.razorpayPayoutId === entity.id when reference_id + notes miss', async () => {
      // Seed a batch whose razorpay_payout_id matches the entity id, with no
      // reference_id and no notes.payout_id pointing at us.
      const [payout] = await db
        .insert(payouts)
        .values({
          vendorUserId: 'u_v',
          destinationFingerprint: 'fp_recon3',
          razorpayFundAccountId: 'fa_recon3',
          batchDay: '2026-01-16',
          status: 'processing',
          amountNetRupees: '1000.00',
          tdsTotal: '0.00',
          tcsTotal: '0.00',
          razorpayPayoutId: 'pout_entity_match',
        })
        .returning({ id: payouts.id })
      const [bk] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_c',
          experienceId,
          slotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: '5000.00',
          pricePerParticipantSnapshot: '2500.00',
          pricingBasisSnapshot: 'per_person_1_2',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'gross',
          cancellationPresetSnapshot: 'flexible',
          payoutState: 'processing',
          payoutBatchId: payout!.id,
        })
        .returning({ id: bookings.id })

      const body = buildPayoutProcessedBody({
        eventId: 'evt_recon_entity',
        payoutEntityId: 'pout_entity_match',
        referenceId: null,
        amountPaise: 100_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payout!.id))
      expect(batch?.status).toBe('paid')
      const [member] = await db.select().from(bookings).where(eq(bookings.id, bk!.id))
      expect(member?.payoutState).toBe('paid')
    })

    it('acks (200 unmatched) and writes an unmatched audit row when no payouts row reconciles — no 400 retry loop', async () => {
      const body = buildPayoutProcessedBody({
        eventId: 'evt_unmatched',
        payoutEntityId: 'pout_unmatched',
        referenceId: '11111111-1111-1111-1111-111111111111', // valid uuid, no row
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.unmatched).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_unmatched'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]?.entityId).toBe('pout_unmatched')
      // No processed audit row, no notifications.
      const processed = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_processed'))
      expect(processed).toHaveLength(0)
    })

    it('acks (200 unmatched) when reference_id is a NON-uuid string (no crash on uuid cast)', async () => {
      const body = buildPayoutProcessedBody({
        eventId: 'evt_nonuuid_ref',
        payoutEntityId: 'pout_nonuuid_ref',
        referenceId: 'not-a-uuid-at-all',
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.unmatched).toBe(true)
    })
  })

  describe('lifecycle / unknown / malformed events', () => {
    it('acks payout.initiated as ignored (200) with no DB effect', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = JSON.stringify({
        entity: 'event',
        event: 'payout.initiated',
        contains: ['payout'],
        payload: {
          payout: {
            entity: {
              id: 'pout_init',
              entity: 'payout',
              amount: 400_000,
              currency: 'INR',
              status: 'initiated',
              reference_id: payoutId,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_init',
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.ignored).toBe(true)
      expect(result.body.ignored).toBe('payout.initiated')
      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('processing')
    })

    it('acks payout.queued as ignored (200)', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payout.queued',
        contains: ['payout'],
        payload: {
          payout: {
            entity: {
              id: 'pout_q',
              entity: 'payout',
              amount: 1,
              currency: 'INR',
              status: 'queued',
              reference_id: null,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_queued',
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.ignored).toBe(true)
      expect(result.body.ignored).toBe('payout.queued')
    })

    it('returns 200 ignored for an unknown event type (e.g. payout.updated)', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payout.updated',
        contains: ['payout'],
        payload: {
          payout: {
            entity: {
              id: 'pout_upd',
              entity: 'payout',
              amount: 1,
              currency: 'INR',
              status: 'updated',
              reference_id: null,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_updated',
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.ignored).toBe(true)
      expect(result.body.ignored).toBe('payout.updated')
    })

    it('returns 400 on unparseable JSON', async () => {
      const body = '{not json'
      const result = await call({ body, signature: sign(body) })
      expect(result.status).toBe(400)
    })

    it('returns 400 when neither header nor body carries an event id', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payout.processed',
        contains: ['payout'],
        payload: {
          payout: {
            entity: {
              id: 'pout_noid',
              entity: 'payout',
              amount: 1,
              currency: 'INR',
              status: 'processed',
              reference_id: null,
            },
          },
        },
        created_at: 1_700_000_000,
        // id missing on purpose
      })
      const result = await call({ body, eventIdHeader: null })
      expect(result.status).toBe(400)
    })

    it('returns 400 when payout.processed payload.payout is missing entirely', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payout.processed',
        contains: ['payout'],
        payload: {},
        created_at: 1_700_000_000,
        id: 'evt_no_payload',
      })
      const result = await call({ body })
      expect(result.status).toBe(400)
    })

    it('sets the dedup key on a successful processed event', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_success_key',
        payoutEntityId: 'pout_success_key',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      const redis = getRedis()
      expect(await redis.get('razorpayx-event:evt_success_key')).toBe('1')
    })

    it('returns 500 with a generic body and CLEARS the dedup key when the DB transaction throws (so Razorpay retries can land)', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutProcessedBody({
        eventId: 'evt_db_throw',
        payoutEntityId: 'pout_db_throw',
        referenceId: payoutId,
        amountPaise: 400_000,
      })

      // Wrap the real db so reads (reconciliation) work, but the write
      // transaction throws — deterministically driving the internal-error arm.
      const throwingDb = new Proxy(db as object, {
        get(target, prop, receiver) {
          if (prop === 'transaction') {
            return async () => {
              throw new Error('simulated DB failure')
            }
          }
          return Reflect.get(target, prop, receiver)
        },
      }) as TestDB

      const result = await processRazorpayXWebhook({
        db: throwingDb,
        body,
        signature: sign(body),
        eventIdHeader: null,
        secret: X_WEBHOOK_SECRET,
      })
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'internal error processing webhook' })

      // The dedup key must be cleared so a retry re-enters the DB path.
      const redis = getRedis()
      expect(await redis.get('razorpayx-event:evt_db_throw')).toBeNull()

      // Nothing committed.
      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('processing')
    })
  })
})

/**
 * Slice 07 — the unhappy payout paths per ADR-0016 (2026-06-18 amendment D5 +
 * "Payout failures"): `payout.failed` (3 retries with exponential backoff, then
 * admin queue + Vendor notification) and `payout.reversed` (the dangerous path:
 * money returned after `processed` → revert from paid, admin-gate any re-pay,
 * NEVER auto-retransfer).
 *
 * Re-queue (retry) = member Bookings → payout_state='pending' AND
 * payout_batch_id=NULL → the next daily cron re-picks them (a NEW payouts row).
 * Route to admin queue (retries exhausted) = member Bookings → 'failed' and
 * KEEP payout_batch_id (cron does NOT re-pick; slice-05 classifier surfaces
 * them to the Admin). Reversed = member Bookings → 'reversed', KEEP
 * payout_batch_id (admin-gated, never re-queued).
 *
 * Idempotency floor is a GUARDED status transition (status='processing' for
 * failed; status='paid' for reversed) — a replay past Redis finds the row
 * already transitioned, returns 0 rows, and skips ALL side-effects.
 */
describe('processRazorpayXWebhook (ADR-0016 D5 — payout.failed / payout.reversed)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let slotId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Payout Retry Vendor',
      slug: 'payout-retry',
      kycTier: 'identity',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'payout-retry-exp',
        title: 'Payout Retry Exp',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2200.00',
        pricePerPerson_6_plus: '2000.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const startAt = new Date(Date.UTC(2026, 0, 1, 6, 0, 0))
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    slotId = slot!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, notification_outbox, notifications, bookings, payouts CASCADE`,
    )
    _resetRedisCacheForTests()
  })

  const DEST_FP = 'fp_retry'

  /**
   * Seed a Payout Batch (default status 'processing') + N member Bookings linked
   * to it (default payout_state 'processing'). `priorFailedCount` seeds that many
   * already-failed payouts rows for the SAME (vendor, destination) on earlier
   * batch_days — the failureCount is COUNT(failed rows) for the group.
   */
  async function seedBatch(args: {
    memberCount: number
    status?: 'processing' | 'paid'
    memberPayoutState?: 'processing' | 'paid'
    batchDay?: string
    priorFailedCount?: number
    razorpayPayoutId?: string
  }): Promise<{ payoutId: string; bookingIds: string[] }> {
    for (let i = 0; i < (args.priorFailedCount ?? 0); i++) {
      await db.insert(payouts).values({
        vendorUserId: 'u_v',
        destinationFingerprint: DEST_FP,
        razorpayFundAccountId: 'fa_test',
        batchDay: `2026-01-0${i + 1}`,
        status: 'failed',
        amountNetRupees: '4000.00',
        tdsTotal: '4.00',
        tcsTotal: '20.00',
        razorpayPayoutId: `pout_prior_${i}`,
        failureReason: 'prior failure',
        attemptCount: 1,
      })
    }

    const [payout] = await db
      .insert(payouts)
      .values({
        vendorUserId: 'u_v',
        destinationFingerprint: DEST_FP,
        razorpayFundAccountId: 'fa_test',
        batchDay: args.batchDay ?? '2026-01-15',
        status: args.status ?? 'processing',
        amountNetRupees: '4000.00',
        tdsTotal: '4.00',
        tcsTotal: '20.00',
        razorpayPayoutId: args.razorpayPayoutId ?? 'pout_seed',
        attemptCount: 0,
      })
      .returning({ id: payouts.id })
    const payoutId = payout!.id

    const bookingIds: string[] = []
    for (let i = 0; i < args.memberCount; i++) {
      const [bk] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_c',
          experienceId,
          slotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: '5000.00',
          pricePerParticipantSnapshot: '2500.00',
          pricingBasisSnapshot: 'per_person_1_2',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'gross',
          cancellationPresetSnapshot: 'flexible',
          payoutState: args.memberPayoutState ?? 'processing',
          payoutBatchId: payoutId,
        })
        .returning({ id: bookings.id })
      bookingIds.push(bk!.id)
    }
    return { payoutId, bookingIds }
  }

  async function call(args: {
    body: string
    signature?: string
    eventIdHeader?: string | null
    secret?: string
  }): Promise<RazorpayXWebhookResult> {
    const signature = args.signature ?? sign(args.body)
    return processRazorpayXWebhook({
      db,
      body: args.body,
      signature,
      eventIdHeader: args.eventIdHeader ?? null,
      secret: args.secret ?? X_WEBHOOK_SECRET,
    })
  }

  describe('payout.failed — retry path (failureCount ≤ 3)', () => {
    it('1st failure: marks payouts failed + attemptCount++, reverts member Bookings to pending and CLEARS payout_batch_id (re-queue)', async () => {
      const { payoutId, bookingIds } = await seedBatch({ memberCount: 2 })

      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_1',
        payoutEntityId: 'pout_fail_1',
        referenceId: payoutId,
        amountPaise: 400_000,
        statusDetails: { reason: 'beneficiary_bank_offline' },
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('failed')
      expect(batch?.attemptCount).toBe(1)
      expect(batch?.failureReason).toBeTruthy()

      const memberRows = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      expect(memberRows).toHaveLength(2)
      // Re-queued: pending + no batch link → the next daily cron re-picks them.
      expect(memberRows.every((r) => r.payoutState === 'pending')).toBe(true)
      expect(memberRows.every((r) => r.payoutBatchId === null)).toBe(true)
    })

    it('writes one payout.webhook_failed audit row with the decision + failureCount', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_audit',
        payoutEntityId: 'pout_fail_audit',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]?.entityId).toBe(payoutId)
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.failureCount).toBe(1)
      expect(payload.decision).toBe('retry')
    })

    it('does NOT notify the Vendor on a retry (transient — re-queued silently)', async () => {
      const { payoutId } = await seedBatch({ memberCount: 2 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_no_notify',
        payoutEntityId: 'pout_fail_no_notify',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(0)
    })

    it('2nd and 3rd failures still retry (failureCount 2 and 3 ≤ 3)', async () => {
      // failureCount = COUNT(failed rows for the group, incl. the current one).
      // priorFailedCount=1 → current failure makes failureCount=2 → still retry.
      const { payoutId } = await seedBatch({ memberCount: 1, priorFailedCount: 1 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_2',
        payoutEntityId: 'pout_fail_2',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.failureCount).toBe(2)
      expect(payload.decision).toBe('retry')

      const [member] = await db.select().from(bookings).where(eq(bookings.payoutBatchId, payoutId))
      // re-queued → no booking remains linked to this batch
      expect(member).toBeUndefined()
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(0)
    })
  })

  describe('payout.failed — admin queue path (retries exhausted, failureCount ≥ 4)', () => {
    it('4th failure: member Bookings → payout_state=failed, KEEPS payout_batch_id (cron will NOT re-pick), Vendor notified', async () => {
      // 3 prior failed rows + this one → failureCount=4 → admin_queue.
      const { payoutId, bookingIds } = await seedBatch({
        memberCount: 2,
        priorFailedCount: 3,
      })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_exhausted',
        payoutEntityId: 'pout_fail_exhausted',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('failed')
      expect(batch?.attemptCount).toBe(1)

      const memberRows = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      // Routed to admin queue: failed + batch link KEPT → cron skips them,
      // slice-05 classifier shows category 'failed' to the Admin.
      expect(memberRows.every((r) => r.payoutState === 'failed')).toBe(true)
      expect(memberRows.every((r) => r.payoutBatchId === payoutId)).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.failureCount).toBe(4)
      expect(payload.decision).toBe('admin_queue')
    })

    it('notifies the Vendor (payout failed) once per member Booking when retries are exhausted', async () => {
      const { bookingIds } = await seedBatch({ memberCount: 2, priorFailedCount: 3 })
      const { payoutId } = await (async () => {
        // re-read the just-seeded current batch id via its members
        const [bk] = await db.select().from(bookings).where(inArray(bookings.id, bookingIds))
        return { payoutId: bk!.payoutBatchId! }
      })()
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_notify',
        payoutEntityId: 'pout_fail_notify',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const notifRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'payout_processed'))
      expect(notifRows).toHaveLength(2)
      expect(notifRows.every((r) => r.userId === 'u_v')).toBe(true)
      expect(notifRows.every((r) => r.title.toLowerCase().includes('failed'))).toBe(true)
      expect(new Set(notifRows.map((r) => r.eventId))).toEqual(
        new Set(bookingIds.map((id) => `payout_failed:${id}`)),
      )
    })
  })

  describe('payout.failed — idempotency (guarded transition)', () => {
    it('Redis dedup: a duplicate event id is a single effect (one transition, one re-queue)', async () => {
      const { payoutId, bookingIds } = await seedBatch({ memberCount: 2 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_dup',
        payoutEntityId: 'pout_fail_dup',
        referenceId: payoutId,
        amountPaise: 400_000,
      })

      const first = await call({ body })
      expect(first.status).toBe(200)
      expect(first.deduped).toBeFalsy()
      const second = await call({ body })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.attemptCount).toBe(1) // not double-counted
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      expect(auditRows).toHaveLength(1)
      const memberRows = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      expect(memberRows.every((r) => r.payoutState === 'pending')).toBe(true)
    })

    it('DB guard: a replay past Redis eviction (new event id) finds the row already failed and skips ALL side-effects', async () => {
      const { payoutId } = await seedBatch({ memberCount: 2 })
      await call({
        body: buildPayoutEventBody({
          event: 'payout.failed',
          eventId: 'evt_fail_evict_0',
          payoutEntityId: 'pout_fail_evict',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })

      _resetRedisCacheForTests()
      const second = await call({
        body: buildPayoutEventBody({
          event: 'payout.failed',
          eventId: 'evt_fail_evict_1',
          payoutEntityId: 'pout_fail_evict',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.attemptCount).toBe(1) // NOT incremented twice
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      expect(auditRows).toHaveLength(1)
    })

    it('1000x serial replay → exactly ONE failed transition + ONE audit + ONE re-queue', async () => {
      const { payoutId, bookingIds } = await seedBatch({ memberCount: 2 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_replay',
        payoutEntityId: 'pout_fail_replay',
        referenceId: payoutId,
        amountPaise: 400_000,
      })

      const results: RazorpayXWebhookResult[] = []
      for (let i = 0; i < 1000; i++) {
        results.push(await call({ body }))
      }
      expect(results.every((r) => r.status === 200)).toBe(true)
      expect(results.filter((r) => r.deduped === true)).toHaveLength(999)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('failed')
      expect(batch?.attemptCount).toBe(1)
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      expect(auditRows).toHaveLength(1)
      const memberRows = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      expect(memberRows.every((r) => r.payoutState === 'pending' && r.payoutBatchId === null)).toBe(
        true,
      )
    })
  })

  describe('payout.reversed — the dangerous path (admin-gated, never auto-retransfer)', () => {
    it('reverts a PAID batch to reversed, reverts member Bookings from paid to reversed, KEEPS payout_batch_id (admin-gated)', async () => {
      const { payoutId, bookingIds } = await seedBatch({
        memberCount: 2,
        status: 'paid',
        memberPayoutState: 'paid',
      })
      const body = buildPayoutEventBody({
        event: 'payout.reversed',
        eventId: 'evt_rev_1',
        payoutEntityId: 'pout_rev_1',
        referenceId: payoutId,
        amountPaise: 400_000,
        statusDetails: { reason: 'reversed_by_bank' },
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('reversed')
      expect(batch?.failureReason).toBeTruthy()

      const memberRows = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      expect(memberRows.every((r) => r.payoutState === 'reversed')).toBe(true)
      // admin-gated: batch link KEPT → cron never re-picks, never re-queued.
      expect(memberRows.every((r) => r.payoutBatchId === payoutId)).toBe(true)
    })

    it('writes a payout.webhook_reversed audit row and ALWAYS notifies the Vendor (state reversed)', async () => {
      const { payoutId, bookingIds } = await seedBatch({
        memberCount: 2,
        status: 'paid',
        memberPayoutState: 'paid',
      })
      const body = buildPayoutEventBody({
        event: 'payout.reversed',
        eventId: 'evt_rev_notify',
        payoutEntityId: 'pout_rev_notify',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      await call({ body })

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_reversed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]?.entityId).toBe(payoutId)

      const notifRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'payout_processed'))
      expect(notifRows).toHaveLength(2)
      expect(notifRows.every((r) => r.userId === 'u_v')).toBe(true)
      expect(notifRows.every((r) => r.title.toLowerCase().includes('reversed'))).toBe(true)
      expect(new Set(notifRows.map((r) => r.eventId))).toEqual(
        new Set(bookingIds.map((id) => `payout_reversed:${id}`)),
      )
    })

    it('NEVER re-queues: no member Booking returns to a re-pickable pending+unbatched state', async () => {
      const { payoutId } = await seedBatch({
        memberCount: 2,
        status: 'paid',
        memberPayoutState: 'paid',
      })
      await call({
        body: buildPayoutEventBody({
          event: 'payout.reversed',
          eventId: 'evt_rev_no_requeue',
          payoutEntityId: 'pout_rev_no_requeue',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })

      // The slice-04 cron candidate filter is state='completed' AND
      // payout_batch_id IS NULL. A reversed booking KEEPS its batch link, so it
      // can NEVER be re-picked — proving admin-gating with no auto-retransfer.
      const reQueueable = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.state, 'completed'), isNull(bookings.payoutBatchId)))
      expect(reQueueable).toHaveLength(0)
    })

    it('does NOT reverse a non-paid (processing) batch — reversal is only valid from paid', async () => {
      const { payoutId, bookingIds } = await seedBatch({
        memberCount: 1,
        status: 'processing',
        memberPayoutState: 'processing',
      })
      const result = await call({
        body: buildPayoutEventBody({
          event: 'payout.reversed',
          eventId: 'evt_rev_not_paid',
          payoutEntityId: 'pout_rev_not_paid',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })
      // Guarded transition (status='paid' only) → 0 rows → no-op, single-effect.
      expect(result.status).toBe(200)
      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('processing') // unchanged
      const [member] = await db.select().from(bookings).where(inArray(bookings.id, bookingIds))
      expect(member?.payoutState).toBe('processing') // unchanged
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_reversed'))
      expect(auditRows).toHaveLength(0)
    })
  })

  describe('payout.reversed — idempotency (guarded transition)', () => {
    it('1000x serial replay → exactly ONE reversed transition + ONE audit + ONE notify per member booking', async () => {
      const { payoutId, bookingIds } = await seedBatch({
        memberCount: 2,
        status: 'paid',
        memberPayoutState: 'paid',
      })
      const body = buildPayoutEventBody({
        event: 'payout.reversed',
        eventId: 'evt_rev_replay',
        payoutEntityId: 'pout_rev_replay',
        referenceId: payoutId,
        amountPaise: 400_000,
      })

      const results: RazorpayXWebhookResult[] = []
      for (let i = 0; i < 1000; i++) {
        results.push(await call({ body }))
      }
      expect(results.every((r) => r.status === 200)).toBe(true)
      expect(results.filter((r) => r.deduped === true)).toHaveLength(999)

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('reversed')
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_reversed'))
      expect(auditRows).toHaveLength(1)
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(2)
      const memberRows = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      expect(memberRows.every((r) => r.payoutState === 'reversed')).toBe(true)
    })

    it('DB guard: a replay past Redis eviction (new event id) finds the row already reversed and skips ALL side-effects', async () => {
      const { payoutId } = await seedBatch({
        memberCount: 2,
        status: 'paid',
        memberPayoutState: 'paid',
      })
      await call({
        body: buildPayoutEventBody({
          event: 'payout.reversed',
          eventId: 'evt_rev_evict_0',
          payoutEntityId: 'pout_rev_evict',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })

      _resetRedisCacheForTests()
      const second = await call({
        body: buildPayoutEventBody({
          event: 'payout.reversed',
          eventId: 'evt_rev_evict_1',
          payoutEntityId: 'pout_rev_evict',
          referenceId: payoutId,
          amountPaise: 400_000,
        }),
      })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_reversed'))
      expect(auditRows).toHaveLength(1)
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(2)
    })
  })

  describe('signature / secret regression for the new events', () => {
    it('payout.failed: returns 401 on a tampered signature and writes nothing', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_bad_sig',
        payoutEntityId: 'pout_fail_bad_sig',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body, signature: 'a'.repeat(64) })
      expect(result.status).toBe(401)
      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.status).toBe('processing')
      const auditRows = await db.select().from(auditLogs)
      expect(auditRows).toHaveLength(0)
    })

    it('payout.reversed: returns 500 (not 401) when the secret is missing — operator-correctable', async () => {
      const { payoutId } = await seedBatch({
        memberCount: 1,
        status: 'paid',
        memberPayoutState: 'paid',
      })
      const body = buildPayoutEventBody({
        event: 'payout.reversed',
        eventId: 'evt_rev_no_secret',
        payoutEntityId: 'pout_rev_no_secret',
        referenceId: payoutId,
        amountPaise: 400_000,
      })
      const result = await call({ body, signature: 'whatever', secret: '' })
      expect(result.status).toBe(500)
    })
  })

  describe('reconciliation + reason extraction for the new events', () => {
    it('payout.failed: acks (200 unmatched) + writes an unmatched audit row when no payouts row reconciles — no retry/notify', async () => {
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_unmatched',
        payoutEntityId: 'pout_fail_unmatched',
        referenceId: '11111111-1111-1111-1111-111111111111', // valid uuid, no row
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.unmatched).toBe(true)

      const unmatched = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_unmatched'))
      expect(unmatched).toHaveLength(1)
      expect(unmatched[0]?.entityId).toBe('pout_fail_unmatched')
      const failed = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_failed'))
      expect(failed).toHaveLength(0)
      const notifRows = await db.select().from(notifications)
      expect(notifRows).toHaveLength(0)
    })

    it('payout.reversed: acks (200 unmatched) + writes an unmatched audit row when no payouts row reconciles', async () => {
      const body = buildPayoutEventBody({
        event: 'payout.reversed',
        eventId: 'evt_rev_unmatched',
        payoutEntityId: 'pout_rev_unmatched',
        referenceId: '22222222-2222-2222-2222-222222222222',
        amountPaise: 400_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.unmatched).toBe(true)

      const unmatched = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_unmatched'))
      expect(unmatched).toHaveLength(1)
      const reversed = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.webhook_reversed'))
      expect(reversed).toHaveLength(0)
    })

    it('payout.failed: records status_details.description as the failure reason when reason is absent', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_desc',
        payoutEntityId: 'pout_fail_desc',
        referenceId: payoutId,
        amountPaise: 400_000,
        statusDetails: { description: 'Beneficiary account closed' },
      })
      await call({ body })

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.failureReason).toBe('Beneficiary account closed')
    })

    it('payout.failed: falls back to the entity status as the reason when status_details is absent', async () => {
      const { payoutId } = await seedBatch({ memberCount: 1 })
      const body = buildPayoutEventBody({
        event: 'payout.failed',
        eventId: 'evt_fail_status_reason',
        payoutEntityId: 'pout_fail_status_reason',
        referenceId: payoutId,
        amountPaise: 400_000,
        status: 'failed',
      })
      await call({ body })

      const [batch] = await db.select().from(payouts).where(eq(payouts.id, payoutId))
      expect(batch?.failureReason).toBe('failed')
    })
  })
})
