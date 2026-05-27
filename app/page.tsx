import { redirect } from 'next/navigation'

/**
 * Root page fallback — redirects to the default locale home page.
 * Under normal operation, the i18n middleware rewrites `/` to
 * `app/[locale]/(marketing)/page.tsx` with locale='en', so this
 * page is only reached if middleware is bypassed.
 */
export default function RootPage() {
  redirect('/')
}
