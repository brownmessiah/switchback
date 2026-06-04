/**
 * `shortRef` — a compact, human-friendly reference for an opaque identifier
 * (booking / loyalty-tx UUID, internal user id) shown in the operator UI.
 *
 * Operators should never have to read a full UUID at a glance: the long id
 * (`70382f50-e11f-4a2b-9c3d-aabbccdd3f50`) is unscannable. `shortRef` derives a
 * stable `OV-3F50`-style tag from the LAST four hex characters of the id (the
 * high-entropy tail of a v4 UUID), uppercased. The full id stays available at
 * the call site behind a `title` attribute / copy affordance.
 *
 * Pure + deterministic — TDD'd in `short-ref.test.ts`.
 */
export function shortRef(id: string | null | undefined): string {
  const trimmed = (id ?? '').trim()
  if (trimmed === '') return 'OV-—'

  // The last hyphen-delimited group of a UUID is its highest-entropy tail; for
  // a non-UUID id we just take the trailing characters of the whole string.
  const lastGroup = trimmed.includes('-') ? trimmed.split('-').pop()! : trimmed
  const tail = lastGroup.slice(-4).toUpperCase()
  return `OV-${tail}`
}
