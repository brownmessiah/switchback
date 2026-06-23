import { Skeleton } from "outvers-next";

export function LoadingCard() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        width: 320,
        padding: 16,
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
      }}
    >
      <Skeleton style={{ width: 48, height: 48, borderRadius: 999 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <Skeleton style={{ height: 12, width: "70%" }} />
        <Skeleton style={{ height: 12, width: "45%" }} />
      </div>
    </div>
  );
}

export function ListingPlaceholder() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 280 }}>
      <Skeleton style={{ height: 160, width: "100%", borderRadius: 12 }} />
      <Skeleton style={{ height: 14, width: "80%" }} />
      <Skeleton style={{ height: 14, width: "55%" }} />
      <Skeleton style={{ height: 14, width: "30%" }} />
    </div>
  );
}
