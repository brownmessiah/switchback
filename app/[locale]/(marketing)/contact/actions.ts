'use server'

import { db } from '@/db/client'
import { createContactTicket, type ContactRawInput } from '@/lib/support/contact'

/**
 * Thin Next.js Server Action boundary for the /contact lead form.
 *
 * All validation + persistence lives in the pure `createContactTicket`
 * (lib/support/contact.ts), which is unit-tested against PGlite. This wrapper
 * exists only to expose that core to the client form across the server-action
 * boundary, binding it to the production `db`. We return a typed result so the
 * client can render success / field-error states — never throw to the client.
 *
 * Per Next's server-actions loader constraints, this module exports ONLY async
 * Server Functions; the result/input TYPES are imported straight from
 * lib/support/contact by consumers.
 */
export async function submitContactAction(
  input: ContactRawInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await createContactTicket(db, input)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      error: 'Something went wrong sending your message. Please try again.',
    }
  }
}
