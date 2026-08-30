import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
      from: 'hello@switchback.in',
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
})
