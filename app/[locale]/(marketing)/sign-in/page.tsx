import { getTranslations, setRequestLocale } from 'next-intl/server'

import { generateAlternates } from '@/lib/seo/hreflang'

import { SignInForm } from './sign-in-form'

interface PageProps {
  params: Promise<{ locale: string }>
  /**
   * `returnTo` opts this page into dynamic rendering (launch-readiness
   * 02) — deliberate: the phone-auth availability gate (slice 03) must
   * be evaluated at request time, not baked into the 13-locale static
   * build inside the Docker image where MSG91_* are absent.
   */
  searchParams: Promise<{ returnTo?: string | string[] }>
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'SignInPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/sign-in', locale),
  }
}

export default async function SignInPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const { returnTo } = await searchParams
  // Raw value threaded as-is; sanitization happens server-side inside
  // the resolvePostAuthPath action (it is client-callable, so it can
  // never trust what the page passed anyway). Never rendered as a href.
  const rawReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-8">
      <SignInForm returnTo={rawReturnTo ?? null} />
    </main>
  )
}
