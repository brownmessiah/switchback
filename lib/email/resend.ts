import { Resend } from 'resend'

import { env } from '@/lib/env'

/**
 * Resend transactional email client. Used for:
 *  - Customer booking confirmations (parallel to WhatsApp; ADR-0003)
 *  - Vendor monthly statements (ADR-0016)
 *  - Refund credit notifications (ADR-0004)
 *  - Admin invitations (ADR-0006)
 *
 * Returns a real client when RESEND_API_KEY is set; otherwise returns
 * a no-op stub so dev environments don't fail on first email send.
 */

interface SendInput {
  from: string
  to: string | string[]
  subject: string
  text?: string
  html?: string
  react?: React.ReactNode
  replyTo?: string
}

interface EmailSender {
  send(input: SendInput): Promise<{ ok: boolean; id?: string; error?: string }>
}

let cached: EmailSender | null = null

export function getEmailSender(): EmailSender {
  if (cached) return cached

  if (env.RESEND_API_KEY) {
    const client = new Resend(env.RESEND_API_KEY)
    cached = {
      async send(input) {
        const result = await client.emails.send({
          from: input.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          react: input.react,
          replyTo: input.replyTo,
        } as Parameters<typeof client.emails.send>[0])
        if (result.error) {
          return { ok: false, error: result.error.message }
        }
        return { ok: true, id: result.data?.id }
      },
    }
    return cached
  }

  cached = {
    async send() {
      return { ok: true, id: 'dev-stub' }
    },
  }
  return cached
}

export function _resetEmailSenderForTests(): void {
  cached = null
}
