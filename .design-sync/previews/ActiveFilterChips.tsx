import { ActiveFilterChips } from "outvers-next";

const container: React.CSSProperties = {
  width: 640,
  maxWidth: "100%",
  padding: 16,
  background: "var(--card)",
};

export function FilteredSearch() {
  return (
    <div style={container}>
      <ActiveFilterChips
        parsed={{
          region: "rishikesh",
          activity: "rafting",
          difficulty: "moderate",
          minPrice: 1000,
          maxPrice: 2000,
          minRating: 4,
          safetyVerified: true,
          cancellation: "flexible",
        }}
      />
    </div>
  );
}

export function SingleFilter() {
  return (
    <div style={container}>
      <ActiveFilterChips parsed={{ activity: "scuba-diving" }} />
    </div>
  );
}
