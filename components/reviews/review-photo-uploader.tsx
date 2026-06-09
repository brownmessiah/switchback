'use client'

import { useState } from 'react'

import { ImageUpload, type UploadedImage } from '@/components/image-upload'
import {
  deleteReviewPhotoAction,
  uploadReviewPhotoAction,
} from '@/lib/reviews/photos'

interface ReviewPhotoUploaderProps {
  /** The Review the photos attach to. The server enforces ownership. */
  reviewId: string
  /** Already-uploaded photos for this review (any moderation status). */
  initialPhotos?: readonly UploadedImage[]
  /** Heading above the drop zone. */
  title: string
  /** Reassures the Customer that photos are moderated before going public. */
  hint: string
  /** Shown after a successful upload (photos enter the moderation queue). */
  pendingNote: string
  /** Shown when an upload fails. */
  uploadError: string
}

/**
 * Customer-facing Review photo uploader (issue 19). Reuses the stateless
 * ImageUpload component and the owner-gated upload/delete server actions.
 * Uploaded photos enter status='pending' and are reviewed before appearing
 * publicly (DECISION D0/D5).
 */
export function ReviewPhotoUploader({
  reviewId,
  initialPhotos = [],
  title,
  hint,
  pendingNote,
  uploadError,
}: ReviewPhotoUploaderProps) {
  const [photos, setPhotos] = useState<UploadedImage[]>([...initialPhotos])
  const [error, setError] = useState<string | null>(null)
  const [uploadedAny, setUploadedAny] = useState(false)

  async function handleUpload(file: File): Promise<UploadedImage | null> {
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('reviewId', reviewId)

    const result = await uploadReviewPhotoAction(formData)
    if (!result.ok) {
      setError(uploadError)
      return null
    }
    setPhotos((prev) => [...prev, result.photo])
    setUploadedAny(true)
    return result.photo
  }

  async function handleDelete(id: string): Promise<boolean> {
    const result = await deleteReviewPhotoAction(id)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id))
    return true
  }

  return (
    <div className="space-y-2" data-testid="review-photo-uploader">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ImageUpload
        images={photos}
        onUpload={handleUpload}
        onDelete={handleDelete}
        maxImages={6}
      />
      {uploadedAny && (
        <p className="text-xs text-success" role="status">
          {pendingNote}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
