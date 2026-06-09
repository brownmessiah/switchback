import Link from 'next/link'
import { Compass, Home } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { buttonVariants } from '@/components/ui/button'

/**
 * Premium 404 (issue 25). Lives OUTSIDE the [locale] segment, so copy resolves
 * through the request-context locale (cookie/header) via getTranslations, the
 * same bridge the (app)/vendor pages use. Two clear next actions — "Explore
 * Experiences" (→ /search) and "Go Home" (→ /) — so a dead-end never strands
 * the visitor.
 */
export default async function NotFound() {
  const t = await getTranslations('NotFound')
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span
        aria-hidden="true"
        className="mb-6 inline-flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Compass className="size-8" />
      </span>
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
        {t('heading')}
      </h1>
      <p className="mt-4 max-w-md text-lg text-muted-foreground">{t('message')}</p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/search"
          className={buttonVariants({ className: 'min-tap gap-2' })}
        >
          <Compass aria-hidden="true" className="size-4" />
          {t('exploreCta')}
        </Link>
        <Link
          href="/"
          className={buttonVariants({
            variant: 'outline',
            className: 'min-tap gap-2',
          })}
        >
          <Home aria-hidden="true" className="size-4" />
          {t('homeCta')}
        </Link>
      </div>
    </main>
  )
}
