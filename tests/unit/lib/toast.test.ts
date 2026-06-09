import { describe, expect, it } from 'vitest'

/**
 * Issue 24 — toast system (DECISION D11: adopt `sonner`).
 *
 * `lib/toast.ts` is the single consistent entry point for firing toasts from
 * client code. It re-exports sonner's `toast` so every action site imports from
 * one place (and a future swap of the toast vendor touches one file). These
 * tests pin that the public surface exists and carries the success/error/info
 * variants the action sites rely on.
 */

import { toast } from '@/lib/toast'

describe('lib/toast', () => {
  it('exposes a callable toast with success/error/info variants', () => {
    expect(typeof toast).toBe('function')
    expect(typeof toast.success).toBe('function')
    expect(typeof toast.error).toBe('function')
    expect(typeof toast.info).toBe('function')
  })
})
