import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SectionForm } from '@/app/admin/site-builder/section-form'

// #107 site-builder redesign to DESIGN.md §4 A2 (variant A "Operations
// Console"): the section editor is a token-true A2 form. We assert
//  - the preserved field ids (`${section}-${field}`) the #27 E2E drives,
//  - the heading uses the brand --font-heading token (not an ad-hoc weight),
//  - "Save Section" drives the SAME saveSection action (no behaviour change)
//    and surfaces the "Saved (vN)" success the #27 E2E asserts.
//
// We mock ONLY the `./actions` Server Function module — the section value
// schemas stay in the non-`'use server'` `./schema` module, so this test would
// fail if section-form regressed to importing schema values from actions.

const saveSection = vi.fn(
  async (_input: unknown): Promise<{ ok: true; version: number }> => ({
    ok: true,
    version: 3,
  }),
)

vi.mock('@/app/admin/site-builder/actions', () => ({
  saveSection: (input: unknown) => saveSection(input as never),
  loadSection: vi.fn(async () => []),
}))

beforeEach(() => {
  saveSection.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('SectionForm (A2, variant A) — token-true + preserved save behaviour', () => {
  it('renders the Hero section fields with the preserved #hero-<field> ids', () => {
    render(<SectionForm section="hero" initialValues={{}} currentVersion={null} />)
    expect(document.querySelector('#hero-title')).not.toBeNull()
    expect(document.querySelector('#hero-subtitle')).not.toBeNull()
  })

  it('renders the section heading with the brand --font-heading token', () => {
    render(<SectionForm section="hero" initialValues={{}} currentVersion={null} />)
    const heading = screen.getByRole('heading', { name: 'Hero' })
    expect(heading.className).toContain('font-heading')
  })

  it('drives the saveSection action from "Save Section" and surfaces "Saved (vN)"', async () => {
    const user = userEvent.setup()
    render(
      <SectionForm section="hero" initialValues={{ title: 'Welcome' }} currentVersion={2} />,
    )

    await user.click(screen.getByRole('button', { name: 'Save Section' }))

    expect(saveSection).toHaveBeenCalledTimes(1)
    expect(saveSection).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'hero', key: 'default' }),
    )
    expect(await screen.findByText(/Saved \(v3\)/)).toBeInTheDocument()
  })
})
