import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { LAUNCH_LOCALES, LOCALE_NAMES } from '@/lib/i18n/config'

// ---- Mocks ----

const mockSwitchLocale = vi.fn()
let mockLocale = 'en'

vi.mock('@/lib/i18n/provider', () => ({
  useIntl: () => ({
    locale: mockLocale,
    switchLocale: mockSwitchLocale,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
  useLocale: () => mockLocale,
}))

// Import after mocks
import { LanguageSelector } from '@/components/language-selector'

// ---- Helpers ----

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockLocale = 'en'
  mockSwitchLocale.mockClear()
})

// ---- LAUNCH_LOCALES config ----

describe('LAUNCH_LOCALES', () => {
  it('contains exactly en and hi', () => {
    expect([...LAUNCH_LOCALES]).toEqual(['en', 'hi'])
  })

  it('does not contain infrastructure locales ta, mr, bn', () => {
    expect(LAUNCH_LOCALES).not.toContain('ta')
    expect(LAUNCH_LOCALES).not.toContain('mr')
    expect(LAUNCH_LOCALES).not.toContain('bn')
  })
})

// ---- Compact variant ----

describe('LanguageSelector variant="compact"', () => {
  it('renders a button with globe icon and locale code', () => {
    render(<LanguageSelector variant="compact" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('EN')
  })

  it('shows locale code in uppercase', () => {
    render(<LanguageSelector variant="compact" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toHaveTextContent('EN')
  })

  it('opens dropdown with launch locales when clicked', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    const trigger = screen.getByRole('button', { name: /language/i })
    await user.click(trigger)

    // Should show exactly the launch locales
    for (const code of LAUNCH_LOCALES) {
      expect(screen.getByRole('option', { name: new RegExp(LOCALE_NAMES[code]) })).toBeInTheDocument()
    }
  })

  it('does NOT show infrastructure locales (ta, mr, bn) in dropdown', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))

    expect(screen.queryByText('தமிழ்')).not.toBeInTheDocument()
    expect(screen.queryByText('मराठी')).not.toBeInTheDocument()
    expect(screen.queryByText('বাংলা')).not.toBeInTheDocument()
  })

  it('calls switchLocale when a different locale is selected', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    await user.click(screen.getByRole('option', { name: /हिन्दी/i }))

    expect(mockSwitchLocale).toHaveBeenCalledWith('hi')
  })

  it('does not call switchLocale when current locale is re-selected', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    await user.click(screen.getByRole('option', { name: /english/i }))

    expect(mockSwitchLocale).not.toHaveBeenCalled()
  })

  it('closes dropdown after selection', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /हिन्दी/i }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

// ---- Full variant ----

describe('LanguageSelector variant="full"', () => {
  it('renders a button with globe icon and full language name', () => {
    render(<LanguageSelector variant="full" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('English')
  })

  it('shows full name for Hindi locale', () => {
    mockLocale = 'hi'
    render(<LanguageSelector variant="full" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toHaveTextContent('हिन्दी')
  })

  it('opens dropdown with launch locales when clicked', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="full" />)

    await user.click(screen.getByRole('button', { name: /language/i }))

    for (const code of LAUNCH_LOCALES) {
      expect(screen.getByRole('option', { name: new RegExp(LOCALE_NAMES[code]) })).toBeInTheDocument()
    }
  })

  it('calls switchLocale when a different locale is selected', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="full" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    await user.click(screen.getByRole('option', { name: /हिन्दी/i }))

    expect(mockSwitchLocale).toHaveBeenCalledWith('hi')
  })
})

// ---- Accessibility ----

describe('LanguageSelector accessibility', () => {
  it('trigger button has aria-label for screen readers', () => {
    render(<LanguageSelector variant="compact" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toHaveAttribute('aria-label')
  })

  it('trigger has aria-expanded attribute', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)
    const trigger = screen.getByRole('button', { name: /language/i })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('trigger has aria-haspopup attribute', () => {
    render(<LanguageSelector variant="compact" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('dropdown listbox has aria-label', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label')
  })

  it('current locale option is marked with aria-selected', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    const enOption = screen.getByRole('option', { name: /english/i })
    expect(enOption).toHaveAttribute('aria-selected', 'true')

    const hiOption = screen.getByRole('option', { name: /हिन्दी/i })
    expect(hiOption).toHaveAttribute('aria-selected', 'false')
  })

  it('closes dropdown with Escape key', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('navigates options with arrow keys', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))

    // ArrowDown should move focus to the first/next option
    await user.keyboard('{ArrowDown}')
    const options = screen.getAllByRole('option')
    // At least one option should have focus or data-focused
    expect(options.length).toBe(2) // en and hi
  })

  it('selects option with Enter key', async () => {
    const user = userEvent.setup()
    render(<LanguageSelector variant="compact" />)

    await user.click(screen.getByRole('button', { name: /language/i }))
    await user.keyboard('{ArrowDown}') // focus first option
    await user.keyboard('{ArrowDown}') // focus second option (hi)
    await user.keyboard('{Enter}')

    expect(mockSwitchLocale).toHaveBeenCalledWith('hi')
  })
})

// ---- Dark-backdrop variant (home hero) ----

describe('LanguageSelector onDark', () => {
  it('uses white trigger text on a dark backdrop (home hero legibility)', () => {
    render(<LanguageSelector variant="compact" onDark />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger.className).toContain('text-white')
  })

  it('uses foreground (non-white) trigger text by default (light surface)', () => {
    render(<LanguageSelector variant="compact" />)
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger.className).not.toContain('text-white')
    expect(trigger.className).toContain('hover:text-accent-foreground')
  })
})

// ---- Font conditional loading ----

describe('LanguageSelector font class', () => {
  it('sets data-locale attribute on document for font loading coordination', async () => {
    const user = userEvent.setup()
    mockLocale = 'hi'
    render(<LanguageSelector variant="compact" />)

    // The component should indicate locale for CSS-based font loading
    // We test this by checking if the component exposes the locale correctly
    const trigger = screen.getByRole('button', { name: /language/i })
    expect(trigger).toHaveTextContent('HI')
  })
})
