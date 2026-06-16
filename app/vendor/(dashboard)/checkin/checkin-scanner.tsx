'use client'

import { CircleAlert, CircleCheck, Info, Loader2, QrCode } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { recordCheckInAction } from './actions'

/**
 * QR check-in scanner (issue #06) — the dependency-light baseline.
 *
 * The customer's QR encodes `<origin>/vendor/checkin?token=<signedToken>`. Staff
 * scan it with ANY phone camera, which opens this page; the `?token=` is passed
 * in as `initialToken` and auto-submitted once. Staff may also paste a code
 * manually. There is NO camera-scanner dependency — the deep-link + manual entry
 * is the realistic flow.
 *
 * Every result state is shown clearly: checked in ✓ / already checked in /
 * invalid or expired / not authorized — all mapped from the sanitized
 * `recordCheckInAction` envelope. Strings are i18n'd via `VendorCheckin`.
 */

type Outcome =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'checked_in' }
  | { kind: 'already' }
  | { kind: 'invalid' }
  | { kind: 'error' }

export function CheckInScanner({ initialToken }: { initialToken: string | null }) {
  const t = useTranslations('VendorCheckin')
  const inputId = useId()

  const [token, setToken] = useState(initialToken ?? '')
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  // Guard so the deep-link token auto-submits exactly once (StrictMode-safe).
  const autoSubmitted = useRef(false)

  async function submit(rawToken: string) {
    const value = rawToken.trim()
    if (!value) {
      setOutcome({ kind: 'invalid' })
      return
    }
    setOutcome({ kind: 'submitting' })
    try {
      const result = await recordCheckInAction(value)
      if (result.ok) {
        setOutcome({ kind: result.alreadyCheckedIn ? 'already' : 'checked_in' })
      } else {
        setOutcome({ kind: 'invalid' })
      }
    } catch {
      setOutcome({ kind: 'error' })
    }
  }

  useEffect(() => {
    // Auto-submit the deep-link token exactly once (the ref guard makes this
    // StrictMode-safe and idempotent across re-renders). `submit` is stable
    // enough for this one-shot effect; we intentionally key only on the token.
    if (initialToken && !autoSubmitted.current) {
      autoSubmitted.current = true
      void submit(initialToken)
    }
  }, [initialToken])

  function reset() {
    setToken('')
    setOutcome({ kind: 'idle' })
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {outcome.kind === 'checked_in' || outcome.kind === 'already' ? (
        <ResultCard
          tone={outcome.kind === 'checked_in' ? 'success' : 'info'}
          title={outcome.kind === 'checked_in' ? t('resultCheckedInTitle') : t('resultAlreadyTitle')}
          body={outcome.kind === 'checked_in' ? t('resultCheckedInBody') : t('resultAlreadyBody')}
          actionLabel={t('scanAgain')}
          onAction={reset}
        />
      ) : outcome.kind === 'invalid' || outcome.kind === 'error' ? (
        <ResultCard
          tone="error"
          title={outcome.kind === 'invalid' ? t('resultInvalidTitle') : t('resultErrorTitle')}
          body={outcome.kind === 'invalid' ? t('resultInvalidBody') : t('resultErrorBody')}
          actionLabel={t('scanAgain')}
          onAction={reset}
        />
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor={inputId}>{t('manualLabel')}</Label>
              <Input
                id={inputId}
                value={token}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('manualPlaceholder')}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono"
              />
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={outcome.kind === 'submitting' || token.trim().length === 0}
              onClick={() => void submit(token)}
            >
              {outcome.kind === 'submitting' ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  {t('submitting')}
                </>
              ) : (
                <>
                  <QrCode aria-hidden="true" />
                  {t('submit')}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

type ResultTone = 'success' | 'info' | 'error'

const TONE_STYLE: Record<ResultTone, { ring: string; ink: string }> = {
  success: { ring: 'bg-success-subtle', ink: 'text-success' },
  info: { ring: 'bg-info-subtle', ink: 'text-info' },
  error: { ring: 'bg-destructive-subtle', ink: 'text-destructive' },
}

const TONE_ICON: Record<ResultTone, (props: { className?: string }) => React.ReactElement> = {
  success: (props) => <CircleCheck {...props} aria-hidden="true" />,
  info: (props) => <Info {...props} aria-hidden="true" />,
  error: (props) => <CircleAlert {...props} aria-hidden="true" />,
}

function ResultCard({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: ResultTone
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  const style = TONE_STYLE[tone]
  const Icon = TONE_ICON[tone]
  return (
    <Card>
      <CardContent className="space-y-4 pt-6 text-center">
        <div
          className={`mx-auto flex size-14 items-center justify-center rounded-full ${style.ring}`}
        >
          <Icon className={`size-7 ${style.ink}`} />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={onAction}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
