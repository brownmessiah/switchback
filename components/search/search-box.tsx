'use client'

import { useState, type FormEvent, type ReactElement } from 'react'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'

interface SearchBoxProps {
  /** SSR initial value from the parsed `q` searchParam. */
  initialQuery: string
  /** Already-translated placeholder, e.g. "Search by destination, activity…". */
  placeholder: string
  /** Already-translated accessible label for the search landmark + input. */
  label: string
  /** Already-translated submit-button label. */
  submitLabel: string
}

/**
 * Prominent keyword search bar for /search (parity with switchback.com's hero
 * search). Submitting navigates with the `q` searchParam merged into the live
 * query (so it composes with the facet rail) — same URL-state contract the
 * FacetForm uses. Empty/whitespace clears `q`. `{ scroll: false }` keeps the
 * results in view on re-search.
 */
export function SearchBox({
  initialQuery,
  placeholder,
  label,
  submitLabel,
}: SearchBoxProps): ReactElement {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(initialQuery)

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const sp = new URLSearchParams(searchParams.toString())
    const q = value.trim()
    if (q) sp.set('q', q)
    else sp.delete('q')
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <form
      role="search"
      aria-label={label}
      data-testid="search-box"
      onSubmit={submit}
      className="relative flex w-full items-center"
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-4 size-5 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 w-full rounded-full pl-12 pr-28 text-base"
      />
      <button
        type="submit"
        className="min-tap absolute right-1.5 inline-flex h-9 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {submitLabel}
      </button>
    </form>
  )
}
