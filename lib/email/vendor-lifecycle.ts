import { env } from '@/lib/env'

/**
 * Vendor lifecycle transactional emails.
 *
 * These are the first real email senders in the codebase: `getEmailSender()`
 * previously had no production caller and the notification email adapter was
 * an empty function body, so no email was ever sent to anyone.
 *
 * Design notes:
 *  - The sender is INJECTED, so content is unit-testable without a network
 *    call or an API key, and the wiring can pass the shared Resend client.
 *  - Every function RETURNS a result and never throws. A bounced email must
 *    not roll back a Vendor's onboarding or an admin's KYC decision — those
 *    have already committed by the time we send.
 *  - Rejection reasons are internal notes written by an admin. They go in the
 *    body, never the subject line, which is the part that shows up in
 *    notification previews and mail-server logs.
 */

export interface VendorEmailInput {
  from: string
  to: string | string[]
  subject: string
  text?: string
  html?: string
  replyTo?: string
}

export type EmailSendResult = { ok: true; id?: string } | { ok: false; error: string }

export interface VendorEmailSender {
  send(input: VendorEmailInput): Promise<EmailSendResult>
}

/** The loose result shape the shared `getEmailSender()` returns. */
interface LooseEmailSender {
  send(input: VendorEmailInput): Promise<{ ok: boolean; id?: string; error?: string }>
}

/**
 * Adapt the shared email client to the discriminated result this module uses.
 *
 * `getEmailSender()` predates these callers and returns `{ ok: boolean }`,
 * which cannot be narrowed. Converting once at the boundary keeps the failure
 * path precisely typed here instead of weakening every result downstream.
 */
export function adaptEmailSender(sender: LooseEmailSender): VendorEmailSender {
  return {
    async send(input) {
      const result = await sender.send(input)
      if (result.ok) return { ok: true, id: result.id }
      return { ok: false, error: result.error ?? 'Email provider reported a failure.' }
    },
  }
}

/**
 * The envelope sender. Resend requires this to be on a domain you have
 * verified (SPF/DKIM), so it is configurable per environment.
 */
const DEFAULT_FROM = 'Outvers <hello@outvers.com>'

function fromAddress(): string {
  return env.EMAIL_FROM ?? DEFAULT_FROM
}

function appUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
}

/**
 * Run a send, converting any thrown provider error into a failed result.
 * Callers treat email as best-effort; this keeps that guarantee in one place.
 */
async function deliver(
  sender: VendorEmailSender,
  input: VendorEmailInput,
): Promise<EmailSendResult> {
  try {
    return await sender.send(input)
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Application received (sent when the Vendor profile is created) ───

export interface VendorApplicationReceivedInput {
  to: string
  businessName: string
}

/**
 * Confirms to a newly-onboarded Vendor that we have their application and
 * that a human will review it. This is the "email on signup" the Vendor
 * actually cares about — it is sent at the point they become a Vendor.
 */
export async function sendVendorApplicationReceivedEmail(
  sender: VendorEmailSender,
  input: VendorApplicationReceivedInput,
): Promise<EmailSendResult> {
  const text = [
    `Hi ${input.businessName},`,
    '',
    'Thanks for registering as a partner on Outvers. Your vendor account is set up.',
    '',
    'Our team will review your details before your listings go live. You can start',
    'building listings right away — submit one for review and it will be published',
    'as soon as your account is verified.',
    '',
    `Your dashboard: ${appUrl()}/vendor/dashboard`,
    '',
    '— The Outvers team',
  ].join('\n')

  return deliver(sender, {
    from: fromAddress(),
    to: input.to,
    subject: `Welcome to Outvers, ${input.businessName}`,
    text,
  })
}

// ── KYC decision (sent when an admin approves or rejects) ────────────

export type VendorKycDecisionInput =
  | {
      to: string
      businessName: string
      decision: 'approved'
      tier: string
      publishedCount: number
    }
  | {
      to: string
      businessName: string
      decision: 'rejected'
      reason: string
    }

/**
 * Tells the Vendor the outcome of an admin's KYC decision — and, on approval,
 * exactly what went live as a result, which is the thing they are waiting on.
 */
export async function sendVendorKycDecisionEmail(
  sender: VendorEmailSender,
  input: VendorKycDecisionInput,
): Promise<EmailSendResult> {
  if (input.decision === 'rejected') {
    const text = [
      `Hi ${input.businessName},`,
      '',
      'We reviewed your Outvers vendor account and could not approve it yet.',
      '',
      'Reason given by our team:',
      input.reason,
      '',
      'You can update your details and we will take another look.',
      `Your dashboard: ${appUrl()}/vendor/dashboard`,
      '',
      '— The Outvers team',
    ].join('\n')

    return deliver(sender, {
      from: fromAddress(),
      to: input.to,
      // The reason is an internal admin note — body only, never the subject.
      subject: 'Your Outvers vendor account was not approved',
      text,
    })
  }

  const livedLine =
    input.publishedCount > 0
      ? `${input.publishedCount} ${input.publishedCount === 1 ? 'listing is' : 'listings are'} now live on outvers.com.`
      : 'Submit a listing for review and it will go live once approved.'

  const text = [
    `Hi ${input.businessName},`,
    '',
    `Good news — your Outvers vendor account has been approved (${input.tier} verification).`,
    '',
    livedLine,
    '',
    `Your dashboard: ${appUrl()}/vendor/dashboard`,
    '',
    '— The Outvers team',
  ].join('\n')

  return deliver(sender, {
    from: fromAddress(),
    to: input.to,
    subject: 'Your Outvers vendor account is approved',
    text,
  })
}
