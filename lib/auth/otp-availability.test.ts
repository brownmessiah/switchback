import { describe, expect, it } from 'vitest'

import { isPhoneAuthEnabled, type PhoneAuthEnv } from './otp-availability'

const fullCreds = {
  MSG91_AUTH_KEY: 'key_123',
  MSG91_SENDER_ID: 'OUTVRS',
  MSG91_OTP_TEMPLATE_ID: 'tpl_abc',
}

function shape(
  nodeEnv: PhoneAuthEnv['NODE_ENV'],
  creds: Partial<typeof fullCreds> = {},
): PhoneAuthEnv {
  return { NODE_ENV: nodeEnv, ...creds }
}

describe('isPhoneAuthEnabled', () => {
  describe('production', () => {
    it('is enabled when all three MSG91 credentials are present', () => {
      expect(isPhoneAuthEnabled(shape('production', fullCreds))).toBe(true)
    })

    // THE load-bearing case (launch-readiness 01): production without MSG91
    // credentials must be disabled. Before this module existed, an absent
    // MSG91_AUTH_KEY silently enabled the '000000' dev bypass — a universal
    // OTP for any phone number on a live financial system.
    it('is disabled when no MSG91 credentials are configured', () => {
      expect(isPhoneAuthEnabled(shape('production'))).toBe(false)
    })

    it('is disabled with only an auth key (send needs sender + template)', () => {
      expect(
        isPhoneAuthEnabled(shape('production', { MSG91_AUTH_KEY: 'key_123' })),
      ).toBe(false)
    })

    it('is disabled with auth key + sender but no template id', () => {
      expect(
        isPhoneAuthEnabled(
          shape('production', {
            MSG91_AUTH_KEY: 'key_123',
            MSG91_SENDER_ID: 'OUTVRS',
          }),
        ),
      ).toBe(false)
    })

    it('is disabled with sender + template but no auth key', () => {
      expect(
        isPhoneAuthEnabled(
          shape('production', {
            MSG91_SENDER_ID: 'OUTVRS',
            MSG91_OTP_TEMPLATE_ID: 'tpl_abc',
          }),
        ),
      ).toBe(false)
    })

    it('treats empty-string credentials as absent', () => {
      expect(
        isPhoneAuthEnabled(
          shape('production', {
            MSG91_AUTH_KEY: '',
            MSG91_SENDER_ID: '',
            MSG91_OTP_TEMPLATE_ID: '',
          }),
        ),
      ).toBe(false)
    })
  })

  describe('development', () => {
    it('is enabled without credentials (local dev bypass)', () => {
      expect(isPhoneAuthEnabled(shape('development'))).toBe(true)
    })

    it('is enabled with full credentials (real MSG91 path)', () => {
      expect(isPhoneAuthEnabled(shape('development', fullCreds))).toBe(true)
    })
  })

  describe('test / E2E', () => {
    it('is enabled without credentials (harness bypass, no live SMS)', () => {
      expect(isPhoneAuthEnabled(shape('test'))).toBe(true)
    })

    it('is enabled with full credentials', () => {
      expect(isPhoneAuthEnabled(shape('test', fullCreds))).toBe(true)
    })
  })
})
