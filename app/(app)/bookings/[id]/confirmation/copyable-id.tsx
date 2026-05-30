'use client'

import { Check, Copy } from 'lucide-react'
import { useState, type ReactElement } from 'react'

import { Button } from '@/components/ui/button'

interface CopyableIdProps {
  /** The full Booking ID. Rendered verbatim (no truncation) and copied to the clipboard. */
  value: string
}

/**
 * Copyable full Booking ID control (#71, Direction B "money-honest").
 *
 * Replaces the as-is `data.bookingId.slice(0, 8)…` truncation — the receipt
 * must expose the COMPLETE Booking ID so a Customer can quote it to support.
 * The id renders in full and a labelled button copies it via the async
 * Clipboard API, with a synchronous `document.execCommand('copy')` fallback
 * for browsers/contexts where `navigator.clipboard` is unavailable (e.g.
 * non-secure origins). A 2s "Copied" affordance confirms the action.
 *
 * Server passes only the serialisable `value` string across the RSC boundary
 * (per the use-client serialisation rule), so there is no hydration mismatch.
 */
export function CopyableId({ value }: CopyableIdProps): ReactElement {
  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    const ok = await copyToClipboard(value)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }

  return (
    <span
      className="flex items-center gap-2"
      data-testid="copy-booking-id"
      data-booking-id={value}
    >
      <span className="font-mono text-xs break-all">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={handleCopy}
        aria-label={copied ? 'Booking ID copied' : 'Copy Booking ID'}
        className="text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <>
            <Check className="text-success" aria-hidden="true" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy aria-hidden="true" />
            <span>Copy</span>
          </>
        )}
      </Button>
    </span>
  )
}

/**
 * Copies `text` to the clipboard. Prefers the async Clipboard API; falls back
 * to a hidden-textarea + `execCommand('copy')` when it is unavailable or
 * rejects (e.g. permissions, insecure context). Returns whether the copy
 * succeeded so the caller only flashes "Copied" on a real success.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path below.
    }
  }

  if (typeof document === 'undefined') return false
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
