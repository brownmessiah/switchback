import { Separator } from "outvers-next";

export function Horizontal() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 300 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Triund Trek</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Dharamshala · 2 days
        </div>
      </div>
      <Separator />
      <div>
        <div style={{ fontWeight: 600 }}>Rishikesh Rafting</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          16 km · Grade III+
        </div>
      </div>
    </div>
  );
}

export function Vertical() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        height: 24,
        fontSize: 14,
        color: "var(--foreground)",
      }}
    >
      <span>Manali</span>
      <Separator orientation="vertical" />
      <span>Rishikesh</span>
      <Separator orientation="vertical" />
      <span>Goa</span>
    </div>
  );
}
