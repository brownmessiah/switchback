import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Info } from 'lucide-react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  alertVariants,
} from '@/components/ui/alert'

afterEach(() => {
  cleanup()
})

// ---- Structure & slots ----

describe('Alert structure', () => {
  it('renders its children', () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something to know.</AlertDescription>
      </Alert>,
    )
    expect(screen.getByText('Heads up')).toBeInTheDocument()
    expect(screen.getByText('Something to know.')).toBeInTheDocument()
  })

  it('exposes data-slot on the root and sub-parts', () => {
    render(
      <Alert data-testid="alert">
        <AlertTitle data-testid="title">T</AlertTitle>
        <AlertDescription data-testid="desc">D</AlertDescription>
      </Alert>,
    )
    expect(screen.getByTestId('alert')).toHaveAttribute('data-slot', 'alert')
    expect(screen.getByTestId('title')).toHaveAttribute(
      'data-slot',
      'alert-title',
    )
    expect(screen.getByTestId('desc')).toHaveAttribute(
      'data-slot',
      'alert-description',
    )
  })

  it('renders a leading lucide icon when provided', () => {
    render(
      <Alert>
        <Info data-testid="icon" />
        <AlertTitle>With icon</AlertTitle>
      </Alert>,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('forwards arbitrary className', () => {
    render(
      <Alert className="custom-x" data-testid="alert">
        body
      </Alert>,
    )
    expect(screen.getByTestId('alert').className).toContain('custom-x')
  })
})

// ---- Accessibility ----

describe('Alert accessibility', () => {
  it('defaults to role="alert"', () => {
    render(<Alert>boom</Alert>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('allows the consumer to override role (e.g. status)', () => {
    render(
      <Alert role="status" data-testid="alert">
        info
      </Alert>,
    )
    const el = screen.getByTestId('alert')
    expect(el).toHaveAttribute('role', 'status')
  })
})

// ---- Variants (DESIGN.md §3 — status tints) ----

describe('Alert variants', () => {
  it('defaults to the default variant on a neutral card surface', () => {
    render(<Alert data-testid="alert">hi</Alert>)
    expect(screen.getByTestId('alert').className).toContain('bg-card')
  })

  const statusCases = [
    { variant: 'destructive', token: 'destructive' },
    { variant: 'success', token: 'success' },
    { variant: 'warning', token: 'warning' },
    { variant: 'info', token: 'info' },
  ] as const

  for (const { variant, token } of statusCases) {
    it(`renders the ${variant} variant using the --${token}-subtle tint`, () => {
      render(
        <Alert variant={variant} data-testid="alert">
          {variant}
        </Alert>,
      )
      const el = screen.getByTestId('alert')
      expect(el.className).toContain(`bg-${token}-subtle`)
      expect(el.className).toContain(`text-${token}`)
    })
  }

  it('alertVariants() returns a class string for every variant', () => {
    for (const variant of [
      'default',
      'destructive',
      'success',
      'warning',
      'info',
    ] as const) {
      const cls = alertVariants({ variant })
      expect(typeof cls).toBe('string')
      expect(cls.length).toBeGreaterThan(0)
    }
  })
})
