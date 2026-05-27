import type { NotificationChannel } from './types'

/**
 * Delivery adapter interface. Each channel (email, whatsapp, sms)
 * implements this to actually send the notification. The outbox
 * processor calls `send()` for each pending outbox row.
 *
 * In-app delivery is implicit (the notification row IS the delivery),
 * so `in_app` does not need an adapter.
 */
export interface DeliveryAdapter {
  readonly channel: NotificationChannel
  send(args: {
    userId: string
    title: string
    body: string
    link?: string | null
  }): Promise<void>
}

/**
 * Stubbed email adapter — TODO: integrate with Resend in M3.
 */
export const emailAdapter: DeliveryAdapter = {
  channel: 'email',
  async send(_args) {
    // TODO: integrate with lib/email/resend.ts
  },
}

/**
 * Stubbed WhatsApp adapter — TODO: integrate with WhatsApp Business API in M3.
 */
export const whatsappAdapter: DeliveryAdapter = {
  channel: 'whatsapp',
  async send(_args) {
    // TODO: integrate with WhatsApp Business API
  },
}

/**
 * Stubbed SMS adapter — TODO: integrate with MSG91 in M3.
 */
export const smsAdapter: DeliveryAdapter = {
  channel: 'sms',
  async send(_args) {
    // TODO: integrate with lib/auth/msg91-provider.ts or dedicated SMS service
  },
}
