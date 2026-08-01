import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { _resetEmailSenderForTests, getEmailSender } from './resend'

describe('getEmailSender', () => {
  beforeEach(() => {
    _resetEmailSenderForTests()
  })

  afterEach(() => {
    _resetEmailSenderForTests()
  })

  it('returns a dev-stub sender when RESEND_API_KEY is unset', async () => {
    const sender = getEmailSender()
    const result = await sender.send({
      from: 'hello@outvers.in',
      to: 'shivam@example.com',
      subject: 'Test',
      text: 'hi',
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('dev-stub')
  })

  it('caches the instance across calls', () => {
    expect(getEmailSender()).toBe(getEmailSender())
  })

  // In development the stub keeps things moving. In PRODUCTION the same
  // silent `{ ok: true }` is a lie: it reports delivery for an email that was
  // never sent, so a missing RESEND_API_KEY would hide broken transactional
  // email indefinitely. Production must fail loudly instead.
  describe('in production without an API key', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
      _resetEmailSenderForTests()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      _resetEmailSenderForTests()
    })

    it('reports failure rather than claiming the email was sent', async () => {
      const result = await getEmailSender().send({
        from: 'hello@outvers.in',
        to: 'shivam@example.com',
        subject: 'Test',
        text: 'hi',
      })

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/RESEND_API_KEY/)
    })
  })
})
