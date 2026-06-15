/**
 * Tests for the vendor account-closure Danger Zone (issue 06).
 *
 * Variant 2 "Bordered destructive card" ported onto real components/tokens.
 * The settings page passes SERVER-COMPUTED eligibility down; this client
 * component never recomputes guards. Asserts:
 *   - BLOCKED → disabled trigger + per-item resolve-first checklist (in-flight
 *     Bookings, unsettled Payout dues) with fix-links + aria-describedby.
 *   - ELIGIBLE → enabled trigger opens a typed-confirm dialog; the destructive
 *     submit stays disabled until the typed input === "CLOSE".
 *   - The action is mocked at the module boundary; we assert real behavior
 *     (enable/disable, what is passed to the action) via the public interface.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'

const closeVendorAccountAction = vi.fn()
const pushMock = vi.fn()

vi.mock('./close-account-actions', () => ({
  closeVendorAccountAction: (...args: unknown[]) => closeVendorAccountAction(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { CloseAccountDangerZone } from './close-account-danger-zone'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  closeVendorAccountAction.mockReset()
  pushMock.mockReset()
})

const ELIGIBLE = {
  canClose: true,
  inFlightCount: 0,
  unsettledDuesCount: 0,
  publishedExperienceCount: 3,
  suspended: false,
}

describe('CloseAccountDangerZone — blocked state', () => {
  it('renders a DISABLED trigger when in-flight Bookings exist', () => {
    renderWithIntl(
      <CloseAccountDangerZone
        eligibility={{ ...ELIGIBLE, canClose: false, inFlightCount: 4 }}
      />,
    )

    const trigger = screen.getByRole('button', { name: /Close Vendor account/i })
    expect(trigger).toBeDisabled()
  })

  it('shows the in-flight Bookings resolve-first item with the count and a fix-link', () => {
    renderWithIntl(
      <CloseAccountDangerZone
        eligibility={{ ...ELIGIBLE, canClose: false, inFlightCount: 4 }}
      />,
    )

    // The reason appears in BOTH the visible checklist item and the sr-only
    // aria-describedby paragraph (intentional a11y duplication) — assert ≥1.
    expect(screen.getAllByText(/You have 4 in-flight Bookings/i).length).toBeGreaterThanOrEqual(1)
    const link = screen.getByRole('link', { name: /View Bookings/i })
    expect(link).toHaveAttribute('href', '/vendor/bookings')
  })

  it('shows the unsettled Payout dues resolve-first item when dues exist', () => {
    renderWithIntl(
      <CloseAccountDangerZone
        eligibility={{ ...ELIGIBLE, canClose: false, unsettledDuesCount: 2 }}
      />,
    )

    expect(
      screen.getAllByText(/You have 2 Bookings with Payouts still to settle/i).length,
    ).toBeGreaterThanOrEqual(1)
    const link = screen.getByRole('link', { name: /View Payout/i })
    expect(link).toHaveAttribute('href', '/vendor/payouts')
  })

  it('describes the disabled trigger via aria-describedby (not color-only)', () => {
    renderWithIntl(
      <CloseAccountDangerZone
        eligibility={{ ...ELIGIBLE, canClose: false, inFlightCount: 1 }}
      />,
    )

    const trigger = screen.getByRole('button', { name: /Close Vendor account/i })
    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const reason = document.getElementById(describedBy!)
    expect(reason).toBeInTheDocument()
    expect(reason!.textContent).toMatch(/resolve|in-flight|Payout/i)
  })
})

describe('CloseAccountDangerZone — eligible state', () => {
  it('renders an ENABLED trigger when the account is clean', () => {
    renderWithIntl(<CloseAccountDangerZone eligibility={ELIGIBLE} />)

    const trigger = screen.getByRole('button', { name: /Close Vendor account/i })
    expect(trigger).toBeEnabled()
  })

  it('opens the typed-confirm dialog when the trigger is clicked', async () => {
    renderWithIntl(<CloseAccountDangerZone eligibility={ELIGIBLE} />)

    fireEvent.click(screen.getByRole('button', { name: /Close Vendor account/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/Close your Vendor account/i)).toBeInTheDocument()
  })

  it('keeps the destructive submit DISABLED until the typed input is exactly CLOSE', async () => {
    renderWithIntl(<CloseAccountDangerZone eligibility={ELIGIBLE} />)

    fireEvent.click(screen.getByRole('button', { name: /Close Vendor account/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    const input = screen.getByLabelText(/type CLOSE/i)
    const submit = within(dialog).getByRole('button', { name: /Close Vendor account/i })

    // Initially disabled.
    expect(submit).toBeDisabled()

    // Wrong casing → still disabled (server-truth phrase is "CLOSE").
    fireEvent.change(input, { target: { value: 'close' } })
    expect(submit).toBeDisabled()

    // Exact phrase → enabled.
    fireEvent.change(input, { target: { value: 'CLOSE' } })
    expect(submit).toBeEnabled()
  })

  it('calls the action with the typed phrase + reason on submit', async () => {
    closeVendorAccountAction.mockResolvedValue({ ok: true })
    renderWithIntl(<CloseAccountDangerZone eligibility={ELIGIBLE} />)

    fireEvent.click(screen.getByRole('button', { name: /Close Vendor account/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    fireEvent.change(screen.getByLabelText(/reason for closing/i), {
      target: { value: 'Moving on' },
    })
    fireEvent.change(screen.getByLabelText(/type CLOSE/i), { target: { value: 'CLOSE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Close Vendor account/i }))

    await waitFor(() => {
      expect(closeVendorAccountAction).toHaveBeenCalledWith({
        confirmPhrase: 'CLOSE',
        reason: 'Moving on',
      })
    })
  })

  it('redirects out of the dashboard after a successful close', async () => {
    closeVendorAccountAction.mockResolvedValue({ ok: true })
    renderWithIntl(<CloseAccountDangerZone eligibility={ELIGIBLE} />)

    fireEvent.click(screen.getByRole('button', { name: /Close Vendor account/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/type CLOSE/i), { target: { value: 'CLOSE' } })
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Close Vendor account/i }))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalled()
    })
  })
})
