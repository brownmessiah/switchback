// design-sync shim: @/app/(app)/wishlist/actions. The real module is a Next
// 'use server' action that pulls auth + DB. WishlistButton (rendered inside
// ExperienceCard) only invokes it from a click handler, never during a static
// preview render, so an inert stub is sufficient.
export async function toggleWishlistAction() {
  return { ok: true, wishlisted: false };
}
