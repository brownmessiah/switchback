import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The 404 page is an async Server Component that resolves copy via
// getTranslations('NotFound'). Mock the server intl bridge so the test asserts
// the premium copy + both CTAs (NOT the translation runtime).
const NOT_FOUND_COPY: Record<string, string> = {
  heading: 'This trail leads nowhere',
  message:
    "The page you're looking for doesn't exist or has moved. Let's get you back to the adventure.",
  exploreCta: 'Explore Experiences',
  homeCta: 'Go Home',
}

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => NOT_FOUND_COPY[key] ?? key,
}))

import NotFound from '@/app/not-found'

afterEach(() => cleanup())

describe('app/not-found.tsx (premium 404)', () => {
  it('renders the premium heading and helpful message', async () => {
    render(await NotFound())
    expect(screen.getByText('This trail leads nowhere')).toBeInTheDocument()
    expect(
      screen.getByText(/doesn't exist or has moved/i),
    ).toBeInTheDocument()
  })

  it('renders an "Explore Experiences" CTA that links to /search', async () => {
    render(await NotFound())
    const explore = screen.getByRole('link', { name: 'Explore Experiences' })
    expect(explore).toHaveAttribute('href', '/search')
  })

  it('renders a "Go Home" CTA that links to /', async () => {
    render(await NotFound())
    const home = screen.getByRole('link', { name: 'Go Home' })
    expect(home).toHaveAttribute('href', '/')
  })
})
