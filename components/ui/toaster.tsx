'use client'

import { Toaster as SonnerToaster } from 'sonner'

/**
 * Issue 24 (DECISION D11) — global toaster, mounted ONCE in the root layout so
 * it is available on every surface (marketing + app + vendor + admin).
 *
 * `richColors` gives success/error/info their accessible colour treatment and
 * `closeButton` makes every toast dismissible (ADR-0018 accessibility). sonner
 * announces normal/success/info toasts with role=status and errors (from
 * `toast.error`) with role=alert, so screen readers get the right urgency.
 * This is a thin wrapper — it exists so the mount point and its options live in
 * one client-boundary component the layout can import.
 *
 * Position `bottom-right` follows the convention used by Vercel, Linear, GitHub
 * and Stripe: transient toasts sit out of the way of the header and primary
 * content instead of overlapping them (a `top-center` toast collided with the
 * site header). On mobile sonner automatically reflows to a full-width strip.
 */
export function Toaster() {
  return <SonnerToaster richColors closeButton position="bottom-right" />
}
