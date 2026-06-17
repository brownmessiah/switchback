import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ListingFormStepper,
  type ListingFormValues,
} from '@/app/vendor/(dashboard)/listings/listing-form-stepper'
import { CANCELLATION_COPY } from '@/lib/payments/cancellation-copy'

/**
 * Issue #10 — the vendor Cancellation-policy section: four preset radios (each
 * showing its plain-language rule from the single CANCELLATION_COPY source), a
 * Non-cancellable option with helper text, and a Reschedule-allowed toggle.
 */

afterEach(() => {
  cleanup()
})

const BASE_VALUES: ListingFormValues = {
  title: 'Test',
  shortDescription: '',
  longDescription: '',
  activity: 'rafting',
  region: 'rishikesh',
  price12: '2500',
  price35: '',
  price6: '',
  cancellationPreset: 'moderate',
  rescheduleAllowed: true,
  paymentModes: ['full_upfront'],
  isCombo: false,
  requiredPermits: [],
  requiresSafetyStack: false,
  difficulty: '',
  durationMinutes: '',
  minAge: '',
  maxGroupSize: '',
  languages: [],
  meetingPoint: '',
  seasonMonths: [],
  highlights: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  itinerary: [],
  pricingVariations: [],
}

function renderOnPolicyStep(overrides: Partial<ListingFormValues> = {}) {
  const result = render(
    <ListingFormStepper
      mode="create"
      initialValues={{ ...BASE_VALUES, ...overrides }}
      onSubmit={vi.fn().mockResolvedValue({ ok: true })}
      submitLabel="Create"
      submitLabelBusy="Creating"
    />,
  )
  // Step 0 = Details, 1 = Pricing, 2 = Policy. Jump straight to Policy via the
  // revisitable stepper nav (the third numbered step button — accessible name "3").
  const nav = screen.getByRole('navigation', { name: /listing builder progress/i })
  fireEvent.click(within(nav).getByRole('button', { name: '3' }))
  return result
}

describe('Cancellation policy section (vendor form, issue #10)', () => {
  it('offers all four named presets as radios', () => {
    renderOnPolicyStep()
    const group = screen.getByRole('radiogroup', { name: /cancellation policy/i })
    const radios = within(group).getAllByRole('radio')
    const values = radios.map((r) => (r as HTMLInputElement).value).sort()
    expect(values).toEqual(['flexible', 'moderate', 'non_cancellable', 'strict'].sort())
  })

  it("shows each windowed preset's plain-language rule from CANCELLATION_COPY", () => {
    renderOnPolicyStep()
    const group = screen.getByRole('radiogroup', { name: /cancellation policy/i })
    expect(within(group).getByText(CANCELLATION_COPY.flexible.rule)).toBeTruthy()
    expect(within(group).getByText(CANCELLATION_COPY.moderate.rule)).toBeTruthy()
    expect(within(group).getByText(CANCELLATION_COPY.strict.rule)).toBeTruthy()
  })

  it('shows the non_cancellable helper text (cannot cancel after payment; exceptional refunds)', () => {
    renderOnPolicyStep()
    expect(screen.getByText(/customers cannot cancel after payment/i)).toBeTruthy()
    expect(screen.getByText(/exceptional refunds/i)).toBeTruthy()
  })

  it('the moderate rule says 72h, never the inaccurate "7 days"', () => {
    renderOnPolicyStep()
    const group = screen.getByRole('radiogroup', { name: /cancellation policy/i })
    const moderate = within(group).getByText(CANCELLATION_COPY.moderate.rule).textContent ?? ''
    expect(moderate).toContain('72')
    expect(moderate).not.toContain('7 days')
  })

  it('selecting non_cancellable updates the chosen preset', () => {
    renderOnPolicyStep()
    const radio = screen.getByRole('radio', { name: /non-cancellable/i }) as HTMLInputElement
    fireEvent.click(radio)
    expect(radio.checked).toBe(true)
  })

  it('renders a Reschedule-allowed toggle reflecting the value (default on)', () => {
    renderOnPolicyStep({ rescheduleAllowed: true })
    const toggle = screen.getByRole('checkbox', { name: /reschedule allowed/i }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('the Reschedule-allowed toggle reflects an off value', () => {
    renderOnPolicyStep({ rescheduleAllowed: false })
    const toggle = screen.getByRole('checkbox', { name: /reschedule allowed/i }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('exposes NO free-form refund-number input (wedge preserved)', () => {
    renderOnPolicyStep()
    // The constant-driven wedge: the only numeric refund figures live inside the
    // fixed preset rules (rendered as radio-label text), never as editable
    // fields. Assert there is NO number/spinbutton input anywhere on the Policy
    // step — a label-text regex would spuriously match the rule prose ("Full
    // refund … 50% refund …"), so we check input roles/types directly.
    expect(screen.queryByRole('spinbutton')).toBeNull()
    const numberInputs = document.querySelectorAll('input[type="number"]')
    expect(numberInputs.length).toBe(0)
  })
})
