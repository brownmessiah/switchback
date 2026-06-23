import { EmptyState } from "outvers-next";
import { Heart, MapPinned } from "lucide-react";

const center: React.CSSProperties = {
  maxWidth: 520,
  margin: "0 auto",
};

export function Wishlist() {
  return (
    <div style={center}>
      <EmptyState
        icon={Heart}
        title="No experiences saved yet"
        description="Tap the heart on any trek, dive, or rafting trip to keep it here for later."
        cta={{ href: "/search", label: "Browse adventures" }}
      />
    </div>
  );
}

export function VendorStorefront() {
  return (
    <div style={center}>
      <EmptyState
        icon={MapPinned}
        title="This operator has no live experiences"
        description="Check back soon — new Himalayan treks and Goa water sports are added every week."
      />
    </div>
  );
}
