import { DashboardBookingsEmpty } from "outvers-next";

const center: React.CSSProperties = {
  maxWidth: 520,
  margin: "0 auto",
};

export function NoBookings() {
  return (
    <div style={center}>
      <DashboardBookingsEmpty
        labels={{
          title: "No bookings yet",
          hint: "Your upcoming and past adventures will appear here once you book.",
          cta: "Explore experiences",
        }}
      />
    </div>
  );
}
