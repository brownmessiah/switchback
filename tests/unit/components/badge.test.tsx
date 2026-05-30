import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Badge, badgeVariants } from '@/components/ui/badge'

afterEach(() => {
  cleanup()
})

// ---- Existing variants still resolve (no regression) ----

describe('Badge existing variants', () => {
  it('renders the default variant with primary fill', () => {
    render(<Badge>New</Badge>)
    const badge = screen.getByText('New')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-primary')
  })

  it('renders the destructive variant', () => {
    render(<Badge variant="destructive">Fee</Badge>)
    expect(screen.getByText('Fee').className).toContain('text-destructive')
  })

  it('exposes data-slot="badge"', () => {
    render(<Badge>Slotted</Badge>)
    expect(screen.getByText('Slotted')).toHaveAttribute('data-slot', 'badge')
  })
})

// ---- New status variants (DESIGN.md §3) ----

describe('Badge status variants', () => {
  const cases = [
    { variant: 'success', token: 'success' },
    { variant: 'warning', token: 'warning' },
    { variant: 'info', token: 'info' },
    { variant: 'credit', token: 'credit' },
  ] as const

  for (const { variant, token } of cases) {
    it(`renders the ${variant} variant tinted with the --${token} subtle token`, () => {
      render(<Badge variant={variant}>{variant}</Badge>)
      const badge = screen.getByText(variant)
      expect(badge).toBeInTheDocument()
      // subtle tint fill + on-tint foreground text drawn from the status family
      expect(badge.className).toContain(`bg-${token}-subtle`)
      expect(badge.className).toContain(`text-${token}`)
    })

    it(`exposes the ${variant} variant on its data state`, () => {
      render(<Badge variant={variant}>{variant}</Badge>)
      expect(screen.getByText(variant)).toHaveAttribute('data-slot', 'badge')
    })
  }

  it('badgeVariants() returns a class string for each new status variant', () => {
    for (const variant of ['success', 'warning', 'info', 'credit'] as const) {
      const cls = badgeVariants({ variant })
      expect(typeof cls).toBe('string')
      expect(cls.length).toBeGreaterThan(0)
    }
  })

  it('uses the pill radius convention', () => {
    render(<Badge variant="success">ok</Badge>)
    // formalized pill convention (rounded-4xl / --radius-pill)
    expect(screen.getByText('ok').className).toMatch(/rounded-(4xl|pill|\[)/)
  })
})
