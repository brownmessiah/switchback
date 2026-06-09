import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — login-required toast on the PDP "Ask a Question" CTA. When a
 * signed-in session expires mid-flow (the action returns `unauthenticated`),
 * the dialog falls back to the sign-in prompt AND a toast explains why. The
 * existing inline sign-in prompt is preserved.
 */

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))
vi.mock('@/lib/toast', () => ({ toast }))

const askExperienceQuestionAction =
  vi.fn<(slug: string, title: string, msg: string) => Promise<unknown>>()
vi.mock('@/app/[locale]/(marketing)/experience/[slug]/ask-question-action', () => ({
  askExperienceQuestionAction: (slug: string, title: string, msg: string) =>
    askExperienceQuestionAction(slug, title, msg),
}))

import { AskQuestion } from '@/app/[locale]/(marketing)/experience/[slug]/ask-question'

const labels = {
  cta: 'Ask a question',
  dialogTitle: 'Ask a question',
  dialogDescription: 'desc',
  messageLabel: 'Message',
  messagePlaceholder: 'placeholder',
  submit: 'Send',
  submitting: 'Sending...',
  success: 'Sent!',
  signedOutPrompt: 'Sign in to ask',
  signIn: 'Sign in',
  cancel: 'Cancel',
  validationError: 'Enter a message',
  genericError: 'Something went wrong',
  toastSignInRequired: 'Sign in to ask a question',
}

beforeEach(() => {
  toast.info.mockClear()
  askExperienceQuestionAction.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('AskQuestion — login-required toast (issue 24)', () => {
  it('fires an info toast when the action returns unauthenticated', async () => {
    askExperienceQuestionAction.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    const user = userEvent.setup()
    render(
      <AskQuestion
        experienceSlug="sunset-kayaking"
        experienceTitle="Sunset Kayaking"
        isSignedIn
        signInHref="/sign-in?next=/experience/sunset-kayaking"
        labels={labels}
      />,
    )

    await user.click(screen.getByTestId('ask-question-trigger'))
    await user.type(screen.getByLabelText('Message'), 'Is gear included?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    // Inline sign-in prompt still shows (preserved UX) …
    expect(await screen.findByTestId('ask-question-signin-prompt')).toBeInTheDocument()
    // … and a toast explains why.
    expect(toast.info).toHaveBeenCalledWith('Sign in to ask a question')
  })
})
