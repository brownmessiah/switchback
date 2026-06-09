/**
 * Issue 24 (DECISION D11) — single toast entry point.
 *
 * Re-exports sonner's `toast` so every client action site imports from ONE
 * place. Keeps usage consistent and makes a future swap of the toast vendor a
 * one-file change. `toast.success` / `toast.error` / `toast.info` map to the
 * accessible variants the `<Toaster richColors closeButton />` renders
 * (role=status for normal/success/info, role=alert for errors).
 */
export { toast } from 'sonner'
