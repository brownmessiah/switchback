'use server'

import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { notifications } from '@/db/schema/notifications'
import { notificationPreferences } from '@/db/schema/notification-preferences'

/**
 * Fetch recent notifications for a user (most recent first).
 * Returns up to `limit` notifications.
 */
export async function getRecentNotifications(
  userId: string,
  limit = 20,
): Promise<{
  notifications: Array<{
    id: string
    type: string
    title: string
    body: string
    link: string | null
    readAt: Date | null
    createdAt: Date
  }>
  unreadCount: number
}> {
  const [notifRows, unreadResult] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      ),
  ])

  return {
    notifications: notifRows,
    unreadCount: unreadResult[0]?.count ?? 0,
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
      ),
    )
}

/**
 * Mark all unread notifications as read for a user.
 */
export async function markAllNotificationsRead(
  userId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
}

/**
 * Load user's notification preferences.
 */
export async function getNotificationPreferences(
  userId: string,
): Promise<
  Array<{
    id: string
    eventType: string
    channel: string
    enabled: boolean
  }>
> {
  return db
    .select({
      id: notificationPreferences.id,
      eventType: notificationPreferences.eventType,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
}

/**
 * Update a notification preference (upsert — insert or update).
 */
export async function upsertNotificationPreference(
  userId: string,
  eventType: string,
  channel: string,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ userId, eventType, channel, enabled })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.eventType,
        notificationPreferences.channel,
      ],
      set: { enabled },
    })
}
