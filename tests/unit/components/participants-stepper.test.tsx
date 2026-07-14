import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Home-redesign issue 07 — the reusable participants stepper, extracted from
 * the PDP booking rail so the hero search and the rail share one control.
 *
 * Contract (parity with the rail's inline stepper): − / value / + cluster,
 * aria-labels `${label} −` / `${label} +`, aria-live value, bounds clamp the
 * buttons (disabled at min/max), a `disabled` prop kills both, an optional
 * `valueText` renders a formatted count (hero: "2 people") in place of the
 * bare number.
 */

import { ParticipantsStepper } from '@/components/search/participants-stepper'

afterEach(() => cleanup())

function setup(props: Partial<Parameters<typeof ParticipantsStepper>[0]> = {}) {
  const onChange = vi.fn()
  const utils = render(
    <ParticipantsStepper
      label="Group size"
      value={props.value ?? 2}
      min={props.min}
      max={props.max ?? 8}
      onChange={onChange}
      disabled={props.disabled}
      valueText={props.valueText}
    />,
  )
  return { onChange, ...utils }
}

describe('ParticipantsStepper', () => {
  it('renders minus/plus buttons with rail-parity aria-labels and a live value', () => {
    const { container } = setup({ value: 3 })
    expect(screen.getByRole('button', { name: 'Group size −' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Group size +' })).toBeInTheDocument()
    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('3')
  })

  it('increments and decrements through onChange', () => {
    const { onChange } = setup({ value: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Group size +' }))
    expect(onChange).toHaveBeenLastCalledWith(3)
    fireEvent.click(screen.getByRole('button', { name: 'Group size −' }))
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('disables − at min and + at max (bounds validated)', () => {
    setup({ value: 1 })
    expect(screen.getByRole('button', { name: 'Group size −' })).toBeDisabled()
    cleanup()
    setup({ value: 8, max: 8 })
    expect(screen.getByRole('button', { name: 'Group size +' })).toBeDisabled()
  })

  it('never calls onChange outside the bounds', () => {
    const { onChange } = setup({ value: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Group size −' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a disabled stepper disables both buttons', () => {
    setup({ value: 3, disabled: true })
    expect(screen.getByRole('button', { name: 'Group size −' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Group size +' })).toBeDisabled()
  })

  it('renders valueText in place of the bare number when provided', () => {
    const { container } = setup({ value: 2, valueText: '2 people' })
    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('2 people')
  })
})
