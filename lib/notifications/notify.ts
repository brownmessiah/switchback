import { eq } from 'drizzle-orm'

import { notificationOutbox } from '@/db/schema/notification-outbox'
import { notifications } from '@/db/schema/notifications'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { loadChannelPreferences } from './preferences'
import { NOTIFICATION_CHANNELS, type NotificationChannel, type NotifyArgs } from './types'

/**
 * Result of a notify() call — either a new notification was created
 * with its outbox rows, or it was skipped because the eventId already
 * existed (idempotent dedup).
 */
export interface NotifyResult {
  readonly created: boolean
  readonly notificationId: string | null
  readonly outboxRows: number
}

/**
 * Core notification engine function.
 *
 * Creates a notification row + one outbox row per channel in the SAME
 * db transaction (or the caller's transaction if `db` is already a
 * transaction handle — the function is tx-safe).
 *
 * Idempotency: if `eventId` is provided and a notification with that
 * event_id already exists, the function returns early without creating
 * duplicates.
 *
 * Preference-aware: loads the user's channel preferences and marks
 * disabled channels as `skipped` in the outbox.
 */
export async function notify(
  db: DBOrTx,
  args: NotifyArgs,
): Promise<NotifyResult> {
  // ── Idempotency check ──────────────────────────────
  if (args.eventId) {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.eventId, args.eventId))
      .limit(1)

    if (existing.length > 0) {
      return { created: false, notificationId: existing[0]!.id, outboxRows: 0 }
    }
  }

  // ── Load user channel preferences ──────────────────
  const prefs = await loadChannelPreferences(db, args.userId, args.type)

  // ── Insert notification row ────────────────────────
  const [notificationRow] = await db
    .insert(notifications)
    .values({
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      link: args.link ?? null,
      eventId: args.eventId ?? null,
    })
    .returning({ id: notifications.id })

  const notificationId = notificationRow!.id

  // ── Fan out to outbox (one row per channel) ────────
  const outboxValues = NOTIFICATION_CHANNELS.map((channel: NotificationChannel) => ({
    notificationId,
    channel,
    status: prefs[channel] ? ('pending' as const) : ('skipped' as const),
  }))

  await db.insert(notificationOutbox).values(outboxValues)

  return {
    created: true,
    notificationId,
    outboxRows: outboxValues.length,
  }
}
