'use client'

/**
 * LanguageSelector — locale switcher with two variants:
 *   - compact: globe icon + two-letter locale code (for site header)
 *   - full: globe icon + full language name (for site footer)
 *
 * Only LAUNCH_LOCALES (en, hi) appear in the dropdown.
 * Uses useIntl().switchLocale for cookie + URL + re-render handling.
 */

import { Globe } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'

import {
  LAUNCH_LOCALES,
  LOCALE_NAMES,
  type LaunchLocale,
  type SupportedLocale,
} from '@/lib/i18n/config'
import { useIntl } from '@/lib/i18n/provider'

interface LanguageSelectorProps {
  readonly variant: 'compact' | 'full'
  /** Optional extra className for the wrapper element. */
  readonly className?: string
}

export function LanguageSelector({
  variant,
  className = '',
}: LanguageSelectorProps): ReactElement {
  const { locale, switchLocale } = useIntl()
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)

  const displayText =
    variant === 'compact'
      ? locale.toUpperCase()
      : LOCALE_NAMES[locale as SupportedLocale]

  // Close on outside click
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        listboxRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Reset focus index when dropdown opens/closes
  useEffect(() => {
    if (open) {
      // Focus the current locale's index
      const currentIndex = (LAUNCH_LOCALES as readonly string[]).indexOf(locale)
      setFocusedIndex(currentIndex >= 0 ? currentIndex : 0)
    } else {
      setFocusedIndex(-1)
    }
  }, [open, locale])

  // Focus the option when focusedIndex changes
  useEffect(() => {
    if (!open || focusedIndex < 0) return
    const options = listboxRef.current?.querySelectorAll('[role="option"]')
    if (options && options[focusedIndex]) {
      ;(options[focusedIndex] as HTMLElement).focus()
    }
  }, [open, focusedIndex])

  const listboxId = 'language-selector-listbox'

  const handleSelect = useCallback(
    (code: LaunchLocale) => {
      if (code !== locale) {
        switchLocale(code)
      }
      setOpen(false)
    },
    [locale, switchLocale],
  )

  const handleTriggerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!open) {
          setOpen(true)
        }
      }
    },
    [open],
  )

  const handleOptionKeyDown = useCallback(
    (e: KeyboardEvent<HTMLLIElement>, code: LaunchLocale, index: number) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault()
          handleSelect(code)
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(Math.min(index + 1, LAUNCH_LOCALES.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(Math.max(index - 1, 0))
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          triggerRef.current?.focus()
          break
      }
    },
    [handleSelect],
  )

  const handleTriggerClick = useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Select language"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Globe className="size-4" aria-hidden="true" />
        <span>{displayText}</span>
      </button>

      {open && (
        <ul
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-label="Available languages"
          className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {LAUNCH_LOCALES.map((code, index) => (
            <li
              key={code}
              role="option"
              aria-selected={code === locale ? 'true' : 'false'}
              tabIndex={focusedIndex === index ? 0 : -1}
              onClick={() => handleSelect(code)}
              onKeyDown={(e) => handleOptionKeyDown(e, code, index)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground ${
                code === locale
                  ? 'bg-accent/50 font-medium'
                  : 'hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <span className="w-6 text-xs uppercase text-muted-foreground">
                {code}
              </span>
              <span>{LOCALE_NAMES[code]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
