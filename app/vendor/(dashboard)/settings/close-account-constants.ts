/**
 * Shared constants for the vendor account-closure flow (issue 06).
 *
 * Kept OUT of close-account-actions.ts because that file is a `'use server'`
 * module — Next.js only allows async function exports there, so a plain const
 * cannot live alongside the Server Actions. Both the server core and the client
 * Danger Zone import the phrase from here.
 */

/**
 * The typed confirmation phrase. Locale-stable + testable — identical across
 * all 13 locales (see the `confirmPhrase` i18n key).
 */
export const CLOSE_CONFIRM_PHRASE = 'CLOSE'
