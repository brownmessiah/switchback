import { redirect } from 'next/navigation'

/**
 * Root `/` redirects to the default locale. M2.1 ships en + hi; en is the
 * default. The locale-aware home lives at `app/[lng]/page.tsx`.
 */
export default function RootPage(): never {
  redirect('/en')
}
