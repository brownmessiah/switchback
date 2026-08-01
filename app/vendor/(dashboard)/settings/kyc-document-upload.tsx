'use client'

import { useId, useState, useTransition } from 'react'

import { Label } from '@/components/ui/label'
import type { KycDocumentKind } from '@/lib/vendor/kyc-documents'

import { uploadKycDocumentAction } from './kyc-upload-actions'

/** What is already on file for this document kind, if anything. */
export interface UploadedKycDocument {
  originalFilename: string | null
  uploadedAt: Date
}

interface KycDocumentUploadProps {
  kind: KycDocumentKind
  label: string
  hint?: string
  uploaded: UploadedKycDocument | null
}

/** Mirrors the server-side allow-list in lib/vendor/kyc-documents.ts. */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'

/**
 * One KYC document slot — the ADR-0007 interim verification path.
 *
 * Replaces the onboarding placeholder that said document upload "will be
 * available when external services are connected", which left the admin
 * Evidence Cockpit rendering fields no Vendor could fill.
 *
 * Deliberately does NOT link to an already-uploaded document. The Vendor only
 * needs to know it is on file; minting a URL to an identity document just to
 * report state would be exposure with no purpose. Admins view them through the
 * auth-gated route.
 */
export function KycDocumentUpload({
  kind,
  label,
  hint,
  uploaded,
}: KycDocumentUploadProps) {
  const inputId = useId()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [justUploaded, setJustUploaded] = useState<string | null>(null)

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setJustUploaded(null)

    const formData = new FormData()
    formData.set('kind', kind)
    formData.set('file', file)

    startTransition(async () => {
      const result = await uploadKycDocumentAction(formData)
      if (result.ok) {
        setJustUploaded(file.name)
        return
      }
      setError(result.error)
    })
  }

  return (
    <div className="space-y-[var(--space-field)]">
      <Label htmlFor={inputId}>{label}</Label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        disabled={isPending}
        onChange={handleChange}
        className="block w-full text-sm file:mr-3 file:rounded-[var(--radius-md)] file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
      />

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {isPending && (
        <p className="text-xs text-muted-foreground">Uploading&hellip;</p>
      )}

      {justUploaded && (
        <p className="text-sm text-success" role="status">
          Uploaded {justUploaded} — our team will review it.
        </p>
      )}

      {!justUploaded && uploaded && (
        <p className="text-xs text-muted-foreground">
          On file: {uploaded.originalFilename ?? 'document'} (uploaded{' '}
          {new Date(uploaded.uploadedAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          ). Choose a new file to replace it.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
