import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — when a Vendor uploads a Document/image on the listing editor, a
 * success toast confirms it (and an error toast on failure). We drive the
 * ImageUpload child's onUpload callback directly (the real drop-zone <input>
 * plumbing is jsdom-hostile) to assert the parent's handler fires the toast.
 */

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const uploadExperienceImageAction = vi.fn<(fd: FormData) => Promise<unknown>>()
const deleteExperienceImageAction = vi.fn<(id: string) => Promise<unknown>>()
const updateExperienceAction = vi.fn()
vi.mock('@/app/vendor/(dashboard)/listings/[id]/edit/actions', () => ({
  uploadExperienceImageAction: (fd: FormData) => uploadExperienceImageAction(fd),
  deleteExperienceImageAction: (id: string) => deleteExperienceImageAction(id),
  updateExperienceAction: () => updateExperienceAction(),
}))

// Capture the onUpload callback the parent passes to ImageUpload so we can
// invoke it in isolation.
let capturedOnUpload: ((file: File) => Promise<unknown>) | null = null
vi.mock('@/components/image-upload', () => ({
  ImageUpload: ({ onUpload }: { onUpload: (file: File) => Promise<unknown> }) => {
    capturedOnUpload = onUpload
    return <div data-testid="image-upload" />
  },
}))

// The listing form stepper is heavy + unrelated; stub it, but RENDER its
// imageSlot (which carries the real ImageUpload child) so the parent wires
// onUpload to our captured mock.
vi.mock('@/app/vendor/(dashboard)/listings/listing-form-stepper', () => ({
  ListingFormStepper: ({ imageSlot }: { imageSlot: React.ReactNode }) => (
    <div data-testid="stepper">{imageSlot}</div>
  ),
  toStructuredSubmitFields: () => ({}),
}))

import { ExperienceEditForm } from '@/app/vendor/(dashboard)/listings/[id]/edit/experience-edit-form'

const experience = {
  id: 'exp-1',
  title: 'Sunset Kayaking',
  shortDescription: '',
  longDescription: '',
  activitySlug: 'kayaking',
  regionSlug: 'goa',
  pricePerPerson_1_2: 2000,
  pricePerPerson_3_5: 1800,
  pricePerPerson_6_plus: 1600,
  cancellationPreset: 'flexible',
  paymentModesAllowed: ['partial_pay'],
  isCombo: false,
  requiredPermits: [],
  requiresSafetyStack: false,
  difficulty: null,
  durationMinutes: null,
  minAge: null,
  maxGroupSize: null,
  includedItems: [],
  excludedItems: [],
  whatToBring: [],
} as never

beforeEach(() => {
  capturedOnUpload = null
  toast.success.mockClear()
  toast.error.mockClear()
  uploadExperienceImageAction.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ExperienceEditForm — document/image upload toast (issue 24)', () => {
  it('fires a success toast when an image uploads', async () => {
    uploadExperienceImageAction.mockResolvedValue({
      ok: true,
      asset: { id: 'img-1', url: '/x.jpg', storageKey: 'k' },
    })
    render(<ExperienceEditForm experience={experience} initialImages={[]} />)
    expect(screen.getByTestId('image-upload')).toBeInTheDocument()
    expect(capturedOnUpload).toBeTypeOf('function')

    await capturedOnUpload!(new File([''], 'doc.jpg', { type: 'image/jpeg' }))

    expect(toast.success).toHaveBeenCalled()
  })

  it('fires an error toast when the upload fails', async () => {
    uploadExperienceImageAction.mockResolvedValue({ ok: false, error: 'Upload failed.' })
    render(<ExperienceEditForm experience={experience} initialImages={[]} />)

    await capturedOnUpload!(new File([''], 'doc.jpg', { type: 'image/jpeg' }))

    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
