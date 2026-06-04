'use client'

import { useState, type ReactElement } from 'react'

import Link from 'next/link'
import { CalendarX, CircleCheck, Clock, Info, Minus, Plus, Users, Wallet } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  bracketKeyFor,
  computeBookingPrice,
  type BracketPrices,
} from '@/lib/experiences/booking-price'

import type { BookingRailBracket, BookingRailClosure } from './booking-rail'

export interface BookingRailInteractiveProps {
  priceTableLabel: string
  /** Ordered 1-2 / 3-5 / 6+ brackets (already-translated labels + prices). */
  brackets: ReadonlyArray<BookingRailBracket>
  perPersonLabel: string
  /** Already-translated "Participants" selector label. */
  participantsLabel: string
  /** Already-translated "Total" label. */
  totalLabel: string
  /** Upper bound for the participant stepper. */
  maxParticipants: number
  /** Partial-pay split labels — present only when the Experience allows it. */
  partialPay?: {
    breakdownLabel: string
    notice: string
    advanceLabel: string
    balanceLabel: string
  }
  freeCancellation: string
  bookNowLabel: string
  /** Base checkout deep link; the selected participant count is appended. */
  checkoutHref: string
  closure?: BookingRailClosure | null
}

function formatRupees(amount: number): string {
  return amount.toLocaleString('en-IN')
}

/**
 * Interactive Booking-rail body (client island). A participant stepper drives
 * the Group-size bracket selection (ADR-0011) and the live Partial-pay
 * Advance/balance split (ADR-0001) — both recompute as the count changes via
 * the pure `computeBookingPrice` helper (the authoritative price is still
 * resolved + snapshotted server-side at Booking-create). The selected count is
 * carried into the Checkout deep link. When a Region closure is active the
 * stepper + CTA are disabled (booking paused).
 */
export function BookingRailInteractive({
  priceTableLabel,
  brackets,
  perPersonLabel,
  participantsLabel,
  totalLabel,
  maxParticipants,
  partialPay,
  freeCancellation,
  bookNowLabel,
  checkoutHref,
  closure,
}: BookingRailInteractiveProps): ReactElement {
  const max = Math.max(1, maxParticipants)
  const [count, setCount] = useState(1)
  const disabled = Boolean(closure)

  const prices: BracketPrices = {
    p12: brackets[0]?.priceRupees ?? 0,
    p35: brackets[1]?.priceRupees ?? brackets[0]?.priceRupees ?? 0,
    p6: brackets[2]?.priceRupees ?? brackets[0]?.priceRupees ?? 0,
  }
  const price = computeBookingPrice(count, prices)
  const activeBracket = bracketKeyFor(count)
  const bracketKeys = ['1_2', '3_5', '6_plus'] as const

  const dec = () => setCount((c) => Math.max(1, c - 1))
  const inc = () => setCount((c) => Math.min(max, c + 1))
  const href = `${checkoutHref}&participants=${count}`

  const stepBtn = buttonVariants({
    variant: 'outline',
    size: 'icon',
    className: 'size-9 rounded-full',
  })

  return (
    <div className="space-y-4">
      {/* Per-participant Group-size bracket price table (ADR-0011). The bracket
          the current count falls into is highlighted so the selector and the
          table read as one control. */}
      <div>
        <p className="mb-2 text-xs text-muted-foreground">{priceTableLabel}</p>
        {/* No aria-label here: the visible caption above already labels the
            table, and a `dl[aria-label]` would collide with the quick-facts
            strip selector the PDP E2E uses to detect structured data. */}
        <dl className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {brackets.map((bracket, i) => {
            const isActive = bracketKeys[i] === activeBracket
            return (
              <div
                key={bracket.label}
                className={cn(
                  'flex items-baseline justify-between px-3 py-2',
                  isActive && 'bg-muted',
                )}
                aria-current={isActive ? 'true' : undefined}
              >
                <dt
                  className={cn(
                    'text-sm text-muted-foreground',
                    isActive && 'font-medium text-foreground',
                  )}
                >
                  {bracket.label}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(bracket.priceRupees)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {perPersonLabel}
                  </span>
                </dd>
              </div>
            )
          })}
        </dl>
      </div>

      {/* Participant stepper — drives the bracket + the live breakdown. */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Users aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {participantsLabel}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={dec}
            disabled={disabled || count <= 1}
            aria-label={`${participantsLabel} −`}
            className={cn(stepBtn, 'disabled:opacity-40')}
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <span
            aria-live="polite"
            className="min-w-7 text-center text-base font-semibold tabular-nums"
          >
            {count}
          </span>
          <button
            type="button"
            onClick={inc}
            disabled={disabled || count >= max}
            aria-label={`${participantsLabel} +`}
            className={cn(stepBtn, 'disabled:opacity-40')}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      {/* Live price breakdown — Total then (when Partial pay is allowed) the
          Advance/balance split, all reactive to the participant count. */}
      <div className="space-y-2">
        {partialPay && (
          <p className="text-xs font-medium text-foreground">{partialPay.breakdownLabel}</p>
        )}
        <dl className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-muted-foreground">
              {totalLabel}
              <span className="ml-1 text-xs">
                ({count} × ₹{formatRupees(price.perPerson)})
              </span>
            </dt>
            <dd className="text-sm font-semibold tabular-nums">
              ₹{formatRupees(price.total)}
            </dd>
          </div>
          {partialPay && (
            <>
              <div className="flex items-baseline justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Wallet aria-hidden="true" className="size-4 shrink-0 text-info" />
                  {partialPay.advanceLabel}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(price.advanceRupees)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  {partialPay.balanceLabel}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(price.balanceRupees)}
                </dd>
              </div>
            </>
          )}
        </dl>
        {partialPay && (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-info-subtle px-3 py-2 text-xs text-info">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{partialPay.notice}</span>
          </p>
        )}
      </div>

      <Separator />

      {closure ? (
        <>
          <div
            role="status"
            className="space-y-1 rounded-[var(--radius-md)] border border-warning/30 bg-warning-subtle p-3 text-sm"
          >
            <p className="flex items-center gap-1.5 font-medium text-warning">
              <CalendarX aria-hidden="true" className="size-4 shrink-0" />
              {closure.heading}
            </p>
            <p className="text-muted-foreground">{closure.reason}</p>
            <p className="text-xs text-muted-foreground">{closure.reopens}</p>
          </div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className={buttonVariants({
              size: 'lg',
              className: 'w-full cursor-not-allowed opacity-60',
            })}
          >
            {bookNowLabel}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            {closure.bookingDisabled}
          </p>
        </>
      ) : (
        <>
          <Link
            href={href}
            className={buttonVariants({ size: 'lg', className: 'w-full' })}
          >
            {bookNowLabel}
          </Link>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-success">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
            {freeCancellation}
          </p>
        </>
      )}
    </div>
  )
}
