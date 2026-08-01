import { getTranslations, setRequestLocale } from 'next-intl/server'

import { generateAlternates } from '@/lib/seo/hreflang'

import { SignInForm } from './sign-in-form'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ next?: string | string[] }>
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>) {
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

  // `next` carries the intent of a visitor bounced here from an auth-gated
  // page (chiefly the vendor funnel). It is passed through untrusted and
  // validated server-side by resolvePostAuthPath before any redirect.
  const { next } = await searchParams
  const nextPath = Array.isArray(next) ? next[0] : next

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-8">
      <SignInForm nextPath={nextPath} />
    </main>
  )
}
