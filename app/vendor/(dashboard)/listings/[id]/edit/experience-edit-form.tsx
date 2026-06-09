'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { ImageUpload, type UploadedImage } from '@/components/image-upload'
import { toast } from '@/lib/toast'
import type { Experience } from '@/db/schema/experiences'
import type { ExperienceItineraryStep } from '@/db/schema/experience-itinerary-steps'

import {
  ListingFormStepper,
  toStructuredSubmitFields,
  type ListingFormValues,
} from '../../listing-form-stepper'
import type { DifficultyValue, StructuredItineraryStep } from '../../structured-fields'
import {
  deleteExperienceImageAction,
  updateExperienceAction,
  uploadExperienceImageAction,
} from './actions'

interface ExperienceEditFormProps {
  experience: Experience
  initialImages: readonly UploadedImage[]
  initialItinerary?: readonly ExperienceItineraryStep[]
}

export function ExperienceEditForm({
  experience,
  initialImages,
  initialItinerary = [],
}: ExperienceEditFormProps) {
  const router = useRouter()
  const [images, setImages] = useState<UploadedImage[]>([...initialImages])

  const handleImageUpload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('experienceId', experience.id)
      const result = await uploadExperienceImageAction(formData)
      if (result.ok) {
        const newImage = {
          id: result.asset.id,
          url: result.asset.url,
          storageKey: result.asset.storageKey,
        }
        setImages((prev) => [...prev, newImage])
        // Document uploaded (issue 24).
        toast.success('Image uploaded.')
        return newImage
      }
      // Surface the upload failure (issue 24) — the action result carries a
      // user-facing reason; fall back to a generic line if absent.
      toast.error('error' in result ? result.error : 'Image upload failed.')
      return null
    },
    [experience.id],
  )

  const handleImageDelete = useCallback(async (id: string): Promise<boolean> => {
    const result = await deleteExperienceImageAction(id)
    if (result.ok) {
      setImages((prev) => prev.filter((img) => img.id !== id))
      return true
    }
    return false
  }, [])

  const initialValues: ListingFormValues = {
    title: experience.title,
    shortDescription: experience.shortDescription ?? '',
    longDescription: experience.longDescription ?? '',
    activity: experience.activitySlug,
    region: experience.regionSlug,
    price12: String(experience.pricePerPerson_1_2),
    price35: String(experience.pricePerPerson_3_5),
    price6: String(experience.pricePerPerson_6_plus),
    cancellationPreset: experience.cancellationPreset,
    paymentModes: [...experience.paymentModesAllowed],
    isCombo: experience.isCombo,
    requiredPermits: [...experience.requiredPermits],
    requiresSafetyStack: experience.requiresSafetyStack,
    // ADR-0017 structured attributes — pre-fill from the saved row so values
    // round-trip on edit.
    difficulty: (experience.difficulty ?? '') as '' | DifficultyValue,
    durationMinutes: experience.durationMinutes != null ? String(experience.durationMinutes) : '',
    minAge: experience.minAge != null ? String(experience.minAge) : '',
    maxGroupSize: experience.maxGroupSize != null ? String(experience.maxGroupSize) : '',
    languages: [...(experience.languages ?? [])],
    meetingPoint: experience.meetingPoint ?? '',
    seasonMonths: [...(experience.seasonMonths ?? [])],
    highlights: [...(experience.highlights ?? [])],
    inclusions: [...(experience.inclusions ?? [])],
    exclusions: [...(experience.exclusions ?? [])],
    whatToBring: [...(experience.whatToBring ?? [])],
    itinerary: initialItinerary.map(
      (s): StructuredItineraryStep => ({
        title: s.title,
        description: s.description,
        dayOffset: s.dayOffset,
        durationMinutes: s.durationMinutes,
      }),
    ),
  }

  async function handleSubmit(values: ListingFormValues) {
    const structured = toStructuredSubmitFields(values)
    const result = await updateExperienceAction({
      id: experience.id,
      title: values.title,
      shortDescription: values.shortDescription || null,
      longDescription: values.longDescription || null,
      activitySlug: values.activity,
      regionSlug: values.region,
      pricePerPerson_1_2: Number(values.price12),
      pricePerPerson_3_5: Number(values.price35),
      pricePerPerson_6_plus: Number(values.price6),
      cancellationPreset: values.cancellationPreset,
      paymentModesAllowed: values.paymentModes as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      isCombo: values.isCombo,
      requiredPermits: values.requiredPermits,
      requiresSafetyStack: values.requiresSafetyStack,
      ...structured,
    })

    if (!result.ok) {
      return { ok: false as const, error: result.error }
    }

    router.refresh()
    return { ok: true as const }
  }

  return (
    <ListingFormStepper
      mode="edit"
      initialValues={initialValues}
      onSubmit={handleSubmit}
      hasImage={images.length > 0}
      submitLabel="Save changes"
      submitLabelBusy="Saving…"
      successText="Experience updated."
      imageSlot={
        <ImageUpload
          images={images}
          onUpload={handleImageUpload}
          onDelete={handleImageDelete}
          maxImages={10}
        />
      }
    />
  )
}
