'use client'

import { useSyncExternalStore, type ReactElement } from 'react'

import { Moon, Sun } from 'lucide-react'

interface ThemeToggleProps {
  /** Already-translated accessible label, e.g. "Toggle dark mode". */
  label: string
  /** Extra classes (e.g. colour overrides over the homepage hero photo). */
  className?: string
}

/** Subscribe to `<html>` class changes so the icon reflects the live theme. */
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

const getSnapshot = (): boolean =>
  document.documentElement.classList.contains('dark')

/** Server + first-hydration snapshot — the light default (Moon icon). */
const getServerSnapshot = (): boolean => false

/**
 * Light/dark theme toggle. The dark palette already lives in globals.css
 * (`.dark`); the no-flash script in the root layout sets the initial class from
 * localStorage/OS. This button flips the `.dark` class on <html> and persists
 * the choice (`switchback-theme`). No theme library — just a class + localStorage.
 *
 * The current theme is read via `useSyncExternalStore` over a MutationObserver
 * on the <html> class, so it stays hydration-safe (server snapshot = light) and
 * updates the icon the instant the class changes — without a setState-in-effect.
 */
export function ThemeToggle({ label, className }: ThemeToggleProps): ReactElement {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle(): void {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('switchback-theme', next ? 'dark' : 'light')
    } catch {
      // storage unavailable (private mode) — the in-page toggle still works.
    }
    // The MutationObserver fires → useSyncExternalStore re-reads → icon updates.
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={isDark}
      className={`flex items-center justify-center rounded-md p-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}
    >
      {isDark ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </button>
  )
}
