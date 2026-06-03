import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  StringListEditor,
  ItineraryEditor,
  type StructuredItineraryStep,
} from '@/app/vendor/(dashboard)/listings/structured-fields'

afterEach(() => {
  cleanup()
})

describe('StringListEditor', () => {
  it('renders one input row per value', () => {
    render(
      <StringListEditor
        label="Highlights"
        values={['Grade III rapids', 'Riverside lunch']}
        onChange={vi.fn()}
        max={6}
      />,
    )
    const rows = screen.getAllByTestId('string-list-row')
    expect(rows).toHaveLength(2)
    expect((rows[0]!.querySelector('input') as HTMLInputElement).value).toBe(
      'Grade III rapids',
    )
  })

  it('adds an empty row when "Add" is clicked', () => {
    const onChange = vi.fn()
    render(
      <StringListEditor label="Highlights" values={['One']} onChange={onChange} max={6} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add highlight/i }))
    expect(onChange).toHaveBeenCalledWith(['One', ''])
  })

  it('removes the row at the given index', () => {
    const onChange = vi.fn()
    render(
      <StringListEditor
        label="Highlights"
        values={['One', 'Two', 'Three']}
        onChange={onChange}
        max={6}
      />,
    )
    const rows = screen.getAllByTestId('string-list-row')
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /remove/i }))
    expect(onChange).toHaveBeenCalledWith(['One', 'Three'])
  })

  it('edits a row value at the given index', () => {
    const onChange = vi.fn()
    render(
      <StringListEditor label="Highlights" values={['One', 'Two']} onChange={onChange} max={6} />,
    )
    const rows = screen.getAllByTestId('string-list-row')
    fireEvent.change(within(rows[0]!).getByRole('textbox'), {
      target: { value: 'Edited' },
    })
    expect(onChange).toHaveBeenCalledWith(['Edited', 'Two'])
  })

  it('disables Add at the max and shows the count', () => {
    render(
      <StringListEditor
        label="Highlights"
        values={['a', 'b', 'c', 'd', 'e', 'f']}
        onChange={vi.fn()}
        max={6}
      />,
    )
    expect(screen.getByRole('button', { name: /add highlight/i })).toBeDisabled()
    expect(screen.getByText('6 / 6')).toBeInTheDocument()
  })
})

describe('ItineraryEditor', () => {
  const twoSteps: StructuredItineraryStep[] = [
    { title: 'Briefing', description: 'Gear up', dayOffset: 0, durationMinutes: 30 },
    { title: 'On the water', description: '', dayOffset: 0, durationMinutes: 180 },
  ]

  it('renders one step card per step', () => {
    render(<ItineraryEditor steps={twoSteps} onChange={vi.fn()} />)
    expect(screen.getAllByTestId('itinerary-step')).toHaveLength(2)
  })

  it('appends a new blank step on "Add step"', () => {
    const onChange = vi.fn()
    render(<ItineraryEditor steps={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add step/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as StructuredItineraryStep[]
    expect(next).toHaveLength(1)
    expect(next[0]!.title).toBe('')
  })

  it('removes the step at the given index', () => {
    const onChange = vi.fn()
    render(<ItineraryEditor steps={twoSteps} onChange={onChange} />)
    const stepCards = screen.getAllByTestId('itinerary-step')
    fireEvent.click(within(stepCards[0]!).getByRole('button', { name: /remove step/i }))
    const next = onChange.mock.calls[0]![0] as StructuredItineraryStep[]
    expect(next).toHaveLength(1)
    expect(next[0]!.title).toBe('On the water')
  })

  it('edits a step title at the given index', () => {
    const onChange = vi.fn()
    render(<ItineraryEditor steps={twoSteps} onChange={onChange} />)
    const stepCards = screen.getAllByTestId('itinerary-step')
    fireEvent.change(within(stepCards[1]!).getByLabelText(/step title/i), {
      target: { value: 'Renamed' },
    })
    const next = onChange.mock.calls[0]![0] as StructuredItineraryStep[]
    expect(next[1]!.title).toBe('Renamed')
  })

  it('moves a step up (reorder by index)', () => {
    const onChange = vi.fn()
    render(<ItineraryEditor steps={twoSteps} onChange={onChange} />)
    const stepCards = screen.getAllByTestId('itinerary-step')
    fireEvent.click(within(stepCards[1]!).getByRole('button', { name: /move up/i }))
    const next = onChange.mock.calls[0]![0] as StructuredItineraryStep[]
    expect(next.map((s) => s.title)).toEqual(['On the water', 'Briefing'])
  })

  it('disables Add step at the 30-step max', () => {
    const many: StructuredItineraryStep[] = Array.from({ length: 30 }, (_, i) => ({
      title: `Step ${i}`,
    }))
    render(<ItineraryEditor steps={many} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /add step/i })).toBeDisabled()
  })
})
