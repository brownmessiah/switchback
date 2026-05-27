import { and, eq } from 'drizzle-orm'

import { notificationPreferences } from '@/db/schema/notification-preferences'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import type { NotificationChannel, NotificationType } from './types'
import { NOTIFICATION_CHANNELS } from './types'

/**
 * Map of channel → enabled for a specific user + event type.
 * Missing entries default to `true` (opt-out model).
 */
export type ChannelPreferenceMap = Record<NotificationChannel, boolean>

/**
 * Load the user's channel preferences for a specific event type.
 * Returns a map of channel → enabled. Channels without an explicit
 * row default to `true` (opt-out model — everything on unless the
 * user explicitly disables it).
 */
export async function loadChannelPreferences(
  db: DBOrTx,
  userId: string,
  eventType: NotificationType,
): Promise<ChannelPreferenceMap> {
  const rows = await db
    .select({
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.eventType, eventType),
      ),
    )

  // Start with all channels enabled (opt-out model)
  const result: ChannelPreferenceMap = {
    in_app: true,
    email: true,
    whatsapp: true,
    sms: true,
  }

  for (const row of rows) {
    const ch = row.channel as NotificationChannel
    if (NOTIFICATION_CHANNELS.includes(ch)) {
      result[ch] = row.enabled
    }
  }

  return result
}
