import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Headout-style single hero search (owner screenshots, 2026-06-11):
 * ONE field — "Destination or activity" — replacing the 4-field structured
 * module. A plain GET form to /search (crawlable, zero-JS) carrying the
 * existing `q` full-text param; date/group-size live on /search's facet rail.
 */

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      `${ns}.${key}`,
}))

import { HomeHeroSearch } from '@/components/home/hero-search'

afterEach(() => cleanup())

describe('HomeHeroSearch', () => {
  it('renders a single q input posting GET to /search', () => {
    const { container } = render(<HomeHeroSearch />)

    const form = container.querySelector('form')
    expect(form).toHaveAttribute('action', '/search')
    expect(form).toHaveAttribute('method', 'get')

    const input = screen.getByRole('searchbox', {
      name: 'HomeSearch.single.label',
    })
    expect(input).toHaveAttribute('name', 'q')
    expect(input).toHaveAttribute(
      'placeholder',
      'HomeSearch.single.placeholder',
    )
  })

  it('has a labelled submit button', () => {
    render(<HomeHeroSearch />)
    expect(
      screen.getByRole('button', { name: 'HomeSearch.single.submit' }),
    ).toBeInTheDocument()
  })
})
