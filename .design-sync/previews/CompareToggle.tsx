import { CompareToggle } from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 16,
  width: 280,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card, 12px)",
};

export function OnCard() {
  return (
    <div style={row}>
      <CompareToggle slug="white-water-rafting-rishikesh-16km" />
      <CompareToggle slug="tandem-paragliding-bir-billing" />
      <CompareToggle slug="scuba-diving-grande-island-goa" />
    </div>
  );
}
