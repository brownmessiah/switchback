import { TrustBadge } from "outvers-next";

const wrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "center",
  maxWidth: 520,
};

export function Verification() {
  return (
    <div style={wrap}>
      <TrustBadge id="verified-vendor" label="Verified operator" />
      <TrustBadge id="safety-checked" label="Safety checked" />
    </div>
  );
}

export function Booking() {
  return (
    <div style={wrap}>
      <TrustBadge id="instant-confirmation" label="Instant confirmation" />
      <TrustBadge id="partial-pay" label="Pay 20% to book" />
      <TrustBadge id="flexible-cancellation" label="Flexible cancellation" />
    </div>
  );
}

export function Suitability() {
  return (
    <div style={wrap}>
      <TrustBadge id="beginner-friendly" label="Beginner friendly" />
    </div>
  );
}
