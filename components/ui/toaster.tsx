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
 */
export function Toaster() {
  return <SonnerToaster richColors closeButton position="top-center" />
}
