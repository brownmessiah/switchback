import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KycDocumentUpload } from '@/app/vendor/(dashboard)/settings/kyc-document-upload'

/**
 * The ADR-0007 interim verification UI: PAN + government ID + selfie, reviewed
 * manually. It replaces a placeholder that told Vendors document upload "will
 * be available when external services are connected" — which meant the admin
 * Evidence Cockpit rendered fields no Vendor could ever fill.
 */

type Result = { ok: true; storageKey: string } | { ok: false; error: string }

const uploadKycDocumentAction = vi.fn(
  async (_fd: FormData): Promise<Result> => ({ ok: true, storageKey: 'k' }),
)

vi.mock('@/app/vendor/(dashboard)/settings/kyc-upload-actions', () => ({
  uploadKycDocumentAction: (fd: FormData) => uploadKycDocumentAction(fd),
}))

beforeEach(() => {
  uploadKycDocumentAction.mockReset()
  uploadKycDocumentAction.mockResolvedValue({ ok: true, storageKey: 'k' })
})
afterEach(() => cleanup())

function pngFile(name = 'id.png'): File {
  return new File([new Uint8Array(8)], name, { type: 'image/png' })
}

describe('KycDocumentUpload', () => {
  it('uploads the chosen file under the requested document kind', async () => {
    const user = userEvent.setup()
    render(<KycDocumentUpload kind="government_id" label="Government ID" uploaded={null} />)

    await user.upload(screen.getByLabelText(/Government ID/i), pngFile())

    expect(uploadKycDocumentAction).toHaveBeenCalledTimes(1)
    const fd = uploadKycDocumentAction.mock.calls[0]![0]
    expect(fd.get('kind')).toBe('government_id')
    expect(fd.get('file')).toBeInstanceOf(File)
  })

  it('confirms the upload in place', async () => {
    const user = userEvent.setup()
    render(<KycDocumentUpload kind="selfie" label="Selfie" uploaded={null} />)

    await user.upload(screen.getByLabelText(/Selfie/i), pngFile())

    expect(await screen.findByRole('status')).toHaveTextContent(/uploaded|received/i)
  })

  it('surfaces a server-side refusal instead of failing silently', async () => {
    const user = userEvent.setup()
    uploadKycDocumentAction.mockResolvedValue({
      ok: false,
      error: 'That file is too large. Maximum size is 8 MB.',
    })
    render(<KycDocumentUpload kind="government_id" label="Government ID" uploaded={null} />)

    await user.upload(screen.getByLabelText(/Government ID/i), pngFile())

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/i)
  })

  it('shows that a document is already on file, without linking to it', async () => {
    // The vendor does not need a link, and minting a URL to an identity
    // document for a page that merely reports state would be needless exposure.
    render(
      <KycDocumentUpload
        kind="government_id"
        label="Government ID"
        uploaded={{ originalFilename: 'passport.jpg', uploadedAt: new Date('2026-08-01') }}
      />,
    )

    expect(screen.getByText(/passport\.jpg/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('lets the vendor replace a document already on file', () => {
    render(
      <KycDocumentUpload
        kind="government_id"
        label="Government ID"
        uploaded={{ originalFilename: 'passport.jpg', uploadedAt: new Date('2026-08-01') }}
      />,
    )

    expect(screen.getByLabelText(/Government ID/i)).toBeEnabled()
  })

  it('accepts only image and PDF types at the picker', () => {
    render(<KycDocumentUpload kind="pan_card" label="PAN card" uploaded={null} />)

    const input = screen.getByLabelText(/PAN card/i)
    expect(input.getAttribute('accept')).toMatch(/image\/|pdf/)
  })
})
