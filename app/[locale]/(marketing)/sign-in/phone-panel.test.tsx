import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Scoped translation stub: returns the bare key, with any interpolation
// values appended, so assertions can pin both the key AND its params
// without coupling to translated copy.
vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(' ')}` : key,
}))

import { PhonePanel } from './phone-panel'
import type { UsePhoneAuthFlow } from './use-phone-auth'

afterEach(() => {
  cleanup()
})

function makeFlow(overrides: Partial<UsePhoneAuthFlow> = {}): UsePhoneAuthFlow {
  return {
    step: 'number',
    phoneValue: '',
    setPhoneValue: vi.fn(),
    code: '',
    setCode: vi.fn(),
    error: null,
    sending: false,
    verifying: false,
    resendCooldown: 0,
    sentToDisplay: null,
    sendCode: vi.fn(async () => undefined),
    verifyCode: vi.fn(async () => undefined),
    editNumber: vi.fn(),
    resend: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('PhonePanel — number step', () => {
  it('renders a labelled number input and a send-code action', () => {
    render(<PhonePanel flow={makeFlow()} />)
    expect(screen.getByLabelText('numberLabel')).toBeVisible()
    expect(screen.getByRole('button', { name: 'sendCodeButton' })).toBeVisible()
    // No OTP field yet — mirrors the email form's progressive disclosure.
    expect(screen.queryByLabelText('codeLabel')).toBeNull()
  })

  it('submits the typed number via sendCode', async () => {
    const user = userEvent.setup()
    const flow = makeFlow({ phoneValue: '9876543210' })
    render(<PhonePanel flow={flow} />)

    await user.click(screen.getByRole('button', { name: 'sendCodeButton' }))
    expect(flow.sendCode).toHaveBeenCalledTimes(1)
  })

  it('shows the sending state and disables the button while in flight', () => {
    render(<PhonePanel flow={makeFlow({ sending: true })} />)
    const button = screen.getByRole('button', { name: 'sending' })
    expect(button).toBeDisabled()
  })

  it('surfaces the flow error as an alert', () => {
    render(<PhonePanel flow={makeFlow({ error: 'invalidNumber' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('invalidNumber')
  })
})

describe('PhonePanel — code step', () => {
  const codeStepFlow = (overrides: Partial<UsePhoneAuthFlow> = {}) =>
    makeFlow({ step: 'code', sentToDisplay: '+91 98765 43210', ...overrides })

  it('shows which number the code was sent to, with an editable number affordance', async () => {
    const user = userEvent.setup()
    const flow = codeStepFlow()
    render(<PhonePanel flow={flow} />)

    expect(screen.getByText(/codeSentTo/)).toHaveTextContent('+91 98765 43210')
    await user.click(screen.getByRole('button', { name: 'editNumber' }))
    expect(flow.editNumber).toHaveBeenCalledTimes(1)
  })

  it('renders an accessible, autofill-friendly OTP input', () => {
    render(<PhonePanel flow={codeStepFlow()} />)
    const input = screen.getByLabelText('codeLabel')
    expect(input).toHaveAttribute('inputMode', 'numeric')
    expect(input).toHaveAttribute('autoComplete', 'one-time-code')
    expect(input).toHaveAttribute('pattern', '[0-9]*')
  })

  it('disables verify until the code is complete', () => {
    render(<PhonePanel flow={codeStepFlow({ code: '123' })} />)
    expect(screen.getByRole('button', { name: 'verifyButton' })).toBeDisabled()
  })

  it('enables verify once the code is complete and submits it', async () => {
    const user = userEvent.setup()
    const flow = codeStepFlow({ code: '123456' })
    render(<PhonePanel flow={flow} />)

    const button = screen.getByRole('button', { name: 'verifyButton' })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(flow.verifyCode).toHaveBeenCalledTimes(1)
  })

  it('disables resend during the cooldown and shows the remaining seconds', () => {
    render(<PhonePanel flow={codeStepFlow({ resendCooldown: 12 })} />)
    const button = screen.getByRole('button', { name: /resendCooldown/ })
    expect(button).toBeDisabled()
  })

  it('allows resend once the cooldown elapses', async () => {
    const user = userEvent.setup()
    const flow = codeStepFlow({ resendCooldown: 0 })
    render(<PhonePanel flow={flow} />)

    const button = screen.getByRole('button', { name: 'resendButton' })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(flow.resend).toHaveBeenCalledTimes(1)
  })

  it('surfaces an invalid-OTP error without losing the code step', () => {
    render(<PhonePanel flow={codeStepFlow({ error: 'invalidCode' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('invalidCode')
    expect(screen.getByLabelText('codeLabel')).toBeVisible()
  })
})
