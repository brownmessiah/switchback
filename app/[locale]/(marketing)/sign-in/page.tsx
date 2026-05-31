import { getTranslations, setRequestLocale } from 'next-intl/server'

import { generateAlternates } from '@/lib/seo/hreflang'

import { SignInForm } from './sign-in-form'

interface PageProps {
  params: Promise<{ locale: string }>
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

export default async function SignInPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-8">
      <SignInForm />
    </main>
  )
}
