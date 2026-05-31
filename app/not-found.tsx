import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { buttonVariants } from '@/components/ui/button'

export default async function NotFound() {
  const t = await getTranslations('NotFound')
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-semibold">{t('heading')}</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        {t('message')}
      </p>
      <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
        {t('backToHome')}
      </Link>
    </main>
  )
}
