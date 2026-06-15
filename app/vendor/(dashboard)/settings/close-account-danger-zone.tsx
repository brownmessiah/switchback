'use client'

import {
  AlertTriangle,
  Calendar,
  CreditCard,
  Loader2,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { closeVendorAccountAction } from './close-account-actions'
import { CLOSE_CONFIRM_PHRASE } from './close-account-constants'

/**
 * Server-computed eligibility shape passed down from the Settings page. The
 * client NEVER recomputes the guards — `canClose` is the server's verdict.
 */
export interface ClosureEligibility {
  canClose: boolean
  inFlightCount: number
  unsettledDuesCount: number
  publishedExperienceCount: number
  suspended: boolean
}

/**
 * Vendor account-closure Danger Zone (issue 06) — Variant 2 "Bordered
 * destructive card" ported onto the real Card/Dialog/Button/Input components
 * and the --destructive token family (no hex, no bespoke dark skin).
 *
 * Blocked → per-item resolve-first checklist + a DISABLED trigger described by
 * aria-describedby. Eligible → an enabled destructive trigger opens a
 * typed-confirm Dialog whose submit stays disabled until the input === "CLOSE".
 */
export function CloseAccountDangerZone({ eligibility }: { eligibility: ClosureEligibility }) {
  const t = useTranslations('VendorSettingsClosure')
  const router = useRouter()
  const reasonId = useId()
  const blockedReasonId = useId()

  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { canClose, inFlightCount, unsettledDuesCount, publishedExperienceCount, suspended } =
    eligibility
  const blocked = !canClose
  const phraseMatches = confirm === CLOSE_CONFIRM_PHRASE

  async function handleConfirm() {
    if (!phraseMatches || submitting) return
    setSubmitting(true)
    try {
      const result = await closeVendorAccountAction({
        confirmPhrase: confirm,
        reason: reason.trim() || null,
      })
      if (!result.ok) {
        toast.error(result.error || t('errorGeneric'))
        return
      }
      toast.success(t('successToast'))
      setOpen(false)
      // The layout gate will also redirect on next nav; push proactively so the
      // user leaves the (now-inaccessible) vendor dashboard immediately.
      router.push('/vendor/onboarding')
    } catch {
      toast.error(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      aria-labelledby="danger-zone-title"
      className="overflow-hidden rounded-xl border-[1.5px] border-destructive bg-card text-card-foreground"
    >
      {/* Tinted header band */}
      <div className="flex items-center gap-2 border-b-[1.5px] border-destructive bg-destructive-subtle px-5 py-2.5">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-destructive" />
        <span className="text-xs font-bold tracking-wider text-destructive uppercase">
          {t('sectionTitle')}
        </span>
      </div>

      <div className="space-y-5 p-5">
        <div className="space-y-1">
          <h2 id="danger-zone-title" className="font-heading text-lg font-semibold tracking-tight">
            {t('sectionTitle')}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">{t('sectionDescription')}</p>
        </div>

        {suspended ? (
          <SuspendedNotice
            message={t('blockedSuspended')}
            linkLabel={t('blockedSuspendedLink')}
            blockedReasonId={blockedReasonId}
          />
        ) : blocked ? (
          <BlockedChecklist
            t={t}
            inFlightCount={inFlightCount}
            unsettledDuesCount={unsettledDuesCount}
            blockedReasonId={blockedReasonId}
          />
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          <Button
            type="button"
            variant="destructive"
            disabled={blocked || suspended}
            aria-describedby={blocked || suspended ? blockedReasonId : undefined}
            onClick={() => setOpen(true)}
          >
            <Trash2 aria-hidden="true" />
            {t('submit')}
          </Button>
        </div>
      </div>

      {/* Typed-confirmation dialog. Initial focus lands on the least-destructive
          action ("Keep my account") via the auto-focused DialogClose. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogConsequenceCustomer')}</DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm">
            <li className="text-card-foreground">
              {t('dialogConsequenceExperiences', { count: publishedExperienceCount })}
            </li>
            <li className="text-muted-foreground">{t('dialogConsequenceRetention')}</li>
            <li className="text-muted-foreground">{t('dialogReversibility')}</li>
          </ul>

          <div className="space-y-2">
            <Label htmlFor={reasonId}>{t('reasonLabel')}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="close-confirm-input">{t('confirmLabel')}</Label>
            <Input
              id="close-confirm-input"
              value={confirm}
              autoComplete="off"
              spellCheck={false}
              placeholder={CLOSE_CONFIRM_PHRASE}
              onChange={(e) => setConfirm(e.target.value)}
              className="font-mono tracking-widest"
            />
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" autoFocus>
                  {t('cancel')}
                </Button>
              }
            />
            <Button
              type="button"
              variant="destructive"
              disabled={!phraseMatches || submitting}
              onClick={handleConfirm}
            >
              {submitting && <Loader2 aria-hidden="true" className="animate-spin" />}
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function BlockedChecklist({
  t,
  inFlightCount,
  unsettledDuesCount,
  blockedReasonId,
}: {
  t: ReturnType<typeof useTranslations>
  inFlightCount: number
  unsettledDuesCount: number
  blockedReasonId: string
}) {
  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-destructive bg-destructive-subtle p-3"
      >
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="text-sm text-card-foreground">{t('blockedTitle')}</p>
      </div>

      <ul className="space-y-2.5">
        {inFlightCount > 0 && (
          <li className="flex items-center gap-3 rounded-xl border bg-background p-3">
            <Calendar aria-hidden="true" className="size-5 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 text-sm text-card-foreground">
              {t('blockedInFlight', { count: inFlightCount })}
            </span>
            <Link
              href="/vendor/bookings"
              className="shrink-0 text-sm font-semibold text-primary underline underline-offset-2"
            >
              {t('blockedInFlightLink')}
            </Link>
          </li>
        )}
        {unsettledDuesCount > 0 && (
          <li className="flex items-center gap-3 rounded-xl border bg-background p-3">
            <CreditCard aria-hidden="true" className="size-5 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 text-sm text-card-foreground">
              {t('blockedDues', { count: unsettledDuesCount })}
            </span>
            <Link
              href="/vendor/payouts"
              className="shrink-0 text-sm font-semibold text-primary underline underline-offset-2"
            >
              {t('blockedDuesLink')}
            </Link>
          </li>
        )}
      </ul>

      {/* Screen-reader description for the disabled trigger (aria-describedby).
          Concatenates the active blocked reasons so the reason is conveyed as
          text, never color-only. */}
      <p id={blockedReasonId} className="sr-only">
        {[
          inFlightCount > 0 ? t('blockedInFlight', { count: inFlightCount }) : null,
          unsettledDuesCount > 0 ? t('blockedDues', { count: unsettledDuesCount }) : null,
        ]
          .filter(Boolean)
          .join(' ')}
      </p>
    </div>
  )
}

function SuspendedNotice({
  message,
  linkLabel,
  blockedReasonId,
}: {
  message: string
  linkLabel: string
  blockedReasonId: string
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive bg-destructive-subtle p-3"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p id={blockedReasonId} className="text-sm text-card-foreground">
        {message}{' '}
        <Link href="/vendor/support" className="font-semibold text-primary underline underline-offset-2">
          {linkLabel}
        </Link>
      </p>
    </div>
  )
}
