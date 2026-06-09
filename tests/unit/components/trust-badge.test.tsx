import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TrustBadge } from '@/components/trust-badge'

afterEach(() => {
  cleanup()
})

describe('TrustBadge', () => {
  it('renders the provided label text', () => {
    render(<TrustBadge id="safety-checked" label="Safety Checked" />)
    expect(screen.getByText('Safety Checked')).toBeTruthy()
  })

  it('renders an accessible icon (aria-hidden) alongside the label', () => {
    const { container } = render(
      <TrustBadge id="verified-vendor" label="Identity verified" />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a distinct icon per badge id', () => {
    const { container: a } = render(
      <TrustBadge id="flexible-cancellation" label="Flexible cancellation" />,
    )
    const { container: b } = render(
      <TrustBadge id="instant-confirmation" label="Instant Confirmation" />,
    )
    const pathA = a.querySelector('svg')?.innerHTML
    const pathB = b.querySelector('svg')?.innerHTML
    expect(pathA).toBeTruthy()
    expect(pathB).toBeTruthy()
    expect(pathA).not.toBe(pathB)
  })

  it('renders a single badge element with the label as its accessible text', () => {
    render(<TrustBadge id="partial-pay" label="Partial Payment Available" />)
    // The label must be real text content (not colour-only signalling).
    expect(screen.getByText('Partial Payment Available').textContent).toBe(
      'Partial Payment Available',
    )
  })
})
