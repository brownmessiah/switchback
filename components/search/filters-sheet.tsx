'use client'

import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface FiltersSheetProps {
  /** Localised "Filters" trigger + Sheet title label. */
  triggerLabel: string
  /** Localised Sheet description (screen-reader context). */
  description: string
  /** The server-rendered facet form, streamed in as Sheet body. */
  children: ReactNode
}

/**
 * Mobile filter Sheet island (DESIGN.md §4 / A4 "Sheet = contextual side
 * task that keeps page context"). On small screens the desktop rail collapses
 * behind this labelled "Filters" trigger; opening the Sheet reveals the SAME
 * facet controls (passed in as server-rendered `children`).
 *
 * The only client boundary on the page — the desktop rail stays SSR. Base UI's
 * Dialog primitive (under Sheet) manages focus trapping, restore-on-close, and
 * Escape, so the panel is keyboard-accessible and axe-clean out of the box.
 */
export function FiltersSheet({
  triggerLabel,
  description,
  children,
}: FiltersSheetProps) {
  return (
    <Sheet>
      <SheetTrigger
        data-testid="search-filters-trigger"
        render={<Button variant="outline" className="w-full sm:w-auto" />}
      >
        <SlidersHorizontal aria-hidden="true" />
        {triggerLabel}
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(22rem,90vw)] overflow-y-auto p-6"
        aria-label={triggerLabel}
      >
        <SheetHeader className="px-0 pt-0">
          <SheetTitle>{triggerLabel}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}
