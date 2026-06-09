/**
 * Tests for AskQuestion — the PDP "Ask a Question" CTA (issue 17, DECISION D6).
 *
 * The CTA opens a Dialog with a question textarea that submits to the enquiry
 * server action (mocked here). Signed-in → submit calls the action and shows a
 * confirmation. Signed-out → the dialog shows a "sign in to ask" prompt that
 * links to /sign-in WITH the PDP path preserved as the return target, and never
 * submits silently.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAction = vi.fn()

vi.mock('./ask-question-action', () => ({
  askExperienceQuestionAction: (...args: unknown[]) => mockAction(...args),
}))

import { AskQuestion } from './ask-question'

const baseLabels = {
  cta: 'Ask a Question',
  dialogTitle: 'Ask a Question',
  dialogDescription: 'Send your question about this Experience to Outvers support.',
  messageLabel: 'Your question',
  messagePlaceholder: 'What would you like to know?',
  submit: 'Send question',
  submitting: 'Sending…',
  success: 'Thanks! Our support team will get back to you.',
  signedOutPrompt: 'Please sign in to ask a question about this Experience.',
  signIn: 'Sign in',
  cancel: 'Cancel',
  validationError: 'Please write your question first.',
  genericError: 'Something went wrong. Please try again.',
  toastSignInRequired: 'Sign in to ask a question about this Experience.',
}

function props(overrides: Partial<React.ComponentProps<typeof AskQuestion>> = {}) {
  return {
    experienceSlug: 'sunrise-trek-triund',
    experienceTitle: 'Sunrise Trek to Triund',
    isSignedIn: true,
    signInHref: '/sign-in?next=/experience/sunrise-trek-triund',
    labels: baseLabels,
    ...overrides,
  }
}

beforeEach(() => {
  mockAction.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('AskQuestion', () => {
  it('renders the "Ask a Question" CTA', () => {
    render(<AskQuestion {...props()} />)
    expect(
      screen.getByRole('button', { name: 'Ask a Question' }),
    ).toBeInTheDocument()
  })

  it('signed-in: submitting calls the enquiry action with the slug, title and message, then confirms', async () => {
    mockAction.mockResolvedValue({ ok: true, id: 'tkt_1' })
    render(<AskQuestion {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ask a Question' }))

    const textarea = await screen.findByLabelText('Your question')
    fireEvent.change(textarea, {
      target: { value: 'Is this beginner friendly?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))

    await waitFor(() => expect(mockAction).toHaveBeenCalledTimes(1))
    expect(mockAction).toHaveBeenCalledWith(
      'sunrise-trek-triund',
      'Sunrise Trek to Triund',
      'Is this beginner friendly?',
    )
    expect(await screen.findByTestId('ask-question-success')).toBeInTheDocument()
  })

  it('signed-out: shows the sign-in prompt linking to /sign-in WITH the PDP context preserved, and never submits', async () => {
    render(<AskQuestion {...props({ isSignedIn: false })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ask a Question' }))

    // The signed-out prompt is shown — not a silent failure.
    expect(
      await screen.findByText(
        'Please sign in to ask a question about this Experience.',
      ),
    ).toBeInTheDocument()

    const signInLink = screen.getByRole('link', { name: 'Sign in' })
    // PDP context (the slug) survives the round-trip via the return URL.
    expect(signInLink).toHaveAttribute(
      'href',
      '/sign-in?next=/experience/sunrise-trek-triund',
    )
    // No textarea / submit path for a signed-out visitor — never silently posts.
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument()
    expect(mockAction).not.toHaveBeenCalled()
  })

  it('validates an empty question before calling the action', async () => {
    render(<AskQuestion {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask a Question' }))
    await screen.findByLabelText('Your question')

    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))

    expect(
      await screen.findByText('Please write your question first.'),
    ).toBeInTheDocument()
    expect(mockAction).not.toHaveBeenCalled()
  })

  it('routes an unauthenticated action result to the sign-in prompt', async () => {
    mockAction.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    render(<AskQuestion {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask a Question' }))

    const textarea = await screen.findByLabelText('Your question')
    fireEvent.change(textarea, { target: { value: 'A question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))

    expect(
      await screen.findByText(
        'Please sign in to ask a question about this Experience.',
      ),
    ).toBeInTheDocument()
  })
})
