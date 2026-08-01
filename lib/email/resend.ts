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

  // No key. In development that is expected and the stub keeps local work
  // moving. In PRODUCTION the same silent `{ ok: true }` is a lie — it reports
  // delivery for an email that was never sent, which would hide broken
  // transactional email indefinitely. Fail loudly instead.
  //
  // It reports a failed result rather than throwing on purpose: every caller
  // treats email as best-effort, so throwing here would turn a misconfigured
  // mailer into a broken signup or a broken admin decision.
  if (process.env.NODE_ENV === 'production') {
    cached = {
      async send() {
        return {
          ok: false,
          error:
            'RESEND_API_KEY is not configured — transactional email cannot be sent in production.',
        }
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
