import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SegmentError } from '@/components/segment-error'

afterEach(() => cleanup())

describe('SegmentError (network/load error boundary UI)', () => {
  it('renders the error heading + a helpful description', () => {
    render(<SegmentError reset={() => {}} />)
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByTestId('segment-error')).toBeInTheDocument()
  })

  it('renders a "Try again" retry button that calls reset()', async () => {
    const reset = vi.fn()
    render(<SegmentError reset={reset} />)
    const retry = screen.getByRole('button', { name: /try again/i })
    await userEvent.click(retry)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
