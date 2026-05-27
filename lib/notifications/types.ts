/**
 * Notification event types — mirrors the notification_type pgEnum.
 * Using a const array + type union keeps runtime values available
 * for iteration while the type stays narrow.
 */
export const NOTIFICATION_TYPES = [
  'booking_created',
  'booking_cancelled',
  'booking_completed',
  'review_posted',
  'payout_processed',
  'listing_approved',
  'listing_rejected',
  'message_received',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/**
 * Delivery channels — mirrors the notification_channel pgEnum.
 */
export const NOTIFICATION_CHANNELS = [
  'in_app',
  'email',
  'whatsapp',
  'sms',
] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

/**
 * Arguments to the `notify()` engine function.
 *
 * `eventId` is optional but strongly recommended for idempotency —
 * domain events that might be replayed (webhooks, cron retries) MUST
 * supply one. The engine skips the insert if a notification with the
 * same event_id already exists.
 */
export interface NotifyArgs {
  readonly userId: string
  readonly type: NotificationType
  readonly title: string
  readonly body: string
  readonly link?: string | null
  readonly eventId?: string | null
}
