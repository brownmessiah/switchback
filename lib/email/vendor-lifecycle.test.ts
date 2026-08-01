import { describe, expect, it, vi } from 'vitest'

import {
  adaptEmailSender,
  sendVendorApplicationReceivedEmail,
  sendVendorKycDecisionEmail,
  type EmailSendResult,
  type VendorEmailSender,
} from './vendor-lifecycle'

/**
 * R2 — "the Vendor receives an email".
 *
 * Nothing in this repo sent an email to anyone before: getEmailSender() had no
 * production caller and the notification email adapter was an empty function
 * body. These are the first real senders.
 *
 * The sender is INJECTED so the content is testable without a network or an
 * API key, and so a delivery failure can be asserted to be non-fatal — a
 * bounced email must never roll back a Vendor's onboarding or an admin's
 * KYC decision.
 */

function recordingSender(result: EmailSendResult = { ok: true, id: 'test-1' }): {
  sender: VendorEmailSender
  sent: Parameters<VendorEmailSender['send']>[0][]
} {
  const sent: Parameters<VendorEmailSender['send']>[0][] = []
  return {
    sent,
    sender: {
      async send(input) {
        sent.push(input)
        return result
      },
    },
  }
}

describe('sendVendorApplicationReceivedEmail', () => {
  it('emails the Vendor at the address they signed up with', async () => {
    const { sender, sent } = recordingSender()

    await sendVendorApplicationReceivedEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('vendor@example.test')
  })

  it('names the business and says a review is pending', async () => {
    const { sender, sent } = recordingSender()

    await sendVendorApplicationReceivedEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
    })

    expect(sent[0]?.subject).toMatch(/Himalayan Rafting Co\./)
    expect(sent[0]?.text).toMatch(/review/i)
  })

  it('reports a delivery failure rather than pretending it sent', async () => {
    const { sender } = recordingSender({ ok: false, error: 'domain not verified' })

    const result = await sendVendorApplicationReceivedEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/domain not verified/)
  })

  it('never throws when the provider blows up', async () => {
    const exploding: VendorEmailSender = {
      async send() {
        throw new Error('connection reset')
      },
    }

    const result = await sendVendorApplicationReceivedEmail(exploding, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
    })

    expect(result.ok).toBe(false)
  })
})

describe('sendVendorKycDecisionEmail', () => {
  it('tells an approved Vendor their listings are live', async () => {
    const { sender, sent } = recordingSender()

    await sendVendorKycDecisionEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
      decision: 'approved',
      tier: 'identity',
      publishedCount: 2,
    })

    expect(sent[0]?.subject).toMatch(/approved/i)
    expect(sent[0]?.text).toMatch(/2 listing/i)
    expect(sent[0]?.text).toMatch(/live/i)
  })

  it('does not promise live listings when none were published', async () => {
    const { sender, sent } = recordingSender()

    await sendVendorKycDecisionEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
      decision: 'approved',
      tier: 'identity',
      publishedCount: 0,
    })

    expect(sent[0]?.text).not.toMatch(/are now live/i)
  })

  it('gives a rejected Vendor the reason', async () => {
    const { sender, sent } = recordingSender()

    await sendVendorKycDecisionEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
      decision: 'rejected',
      reason: 'PAN does not match the submitted name.',
    })

    expect(sent[0]?.subject).toMatch(/not approved|rejected/i)
    expect(sent[0]?.text).toMatch(/PAN does not match the submitted name\./)
  })

  it('never leaks the raw rejection reason into the subject line', async () => {
    const { sender, sent } = recordingSender()

    await sendVendorKycDecisionEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
      decision: 'rejected',
      reason: 'Suspected fraud — flagged by ops, do not disclose internally.',
    })

    expect(sent[0]?.subject).not.toMatch(/Suspected fraud/)
  })

  it('never throws when the provider blows up', async () => {
    const exploding: VendorEmailSender = {
      async send() {
        throw new Error('connection reset')
      },
    }

    const result = await sendVendorKycDecisionEmail(exploding, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
      decision: 'approved',
      tier: 'identity',
      publishedCount: 1,
    })

    expect(result.ok).toBe(false)
  })
})

describe('adaptEmailSender', () => {
  // The shared getEmailSender() predates these callers and returns a loose
  // `{ ok: boolean }`. Narrowing it at the boundary keeps the failure path
  // typed rather than weakening every result in this module.
  it('narrows a successful loose result', async () => {
    const adapted = adaptEmailSender({
      async send() {
        return { ok: true, id: 'abc' }
      },
    })

    const result = await adapted.send({
      from: 'a@b.test',
      to: 'c@d.test',
      subject: 's',
      text: 't',
    })

    expect(result).toEqual({ ok: true, id: 'abc' })
  })

  it('narrows a failed loose result and always carries a reason', async () => {
    const adapted = adaptEmailSender({
      async send() {
        return { ok: false }
      },
    })

    const result = await adapted.send({
      from: 'a@b.test',
      to: 'c@d.test',
      subject: 's',
      text: 't',
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBeTruthy()
  })
})

describe('every vendor lifecycle email', () => {
  it('sends from a configured address', async () => {
    const { sender, sent } = recordingSender()
    await sendVendorApplicationReceivedEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
    })
    expect(sent[0]?.from).toMatch(/@/)
  })

  it('carries a plain-text body so it is readable without HTML', async () => {
    const { sender, sent } = recordingSender()
    await sendVendorKycDecisionEmail(sender, {
      to: 'vendor@example.test',
      businessName: 'Himalayan Rafting Co.',
      decision: 'approved',
      tier: 'business',
      publishedCount: 1,
    })
    expect(sent[0]?.text).toBeTruthy()
  })
})
