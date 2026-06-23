import { ReviewStars } from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const meta: React.CSSProperties = {
  fontSize: 14,
  color: "var(--muted-foreground)",
};

export function Ratings() {
  return (
    <div style={stack}>
      <div style={row}>
        <ReviewStars rating={5} />
        <span style={meta}>Rishikesh white-water rafting</span>
      </div>
      <div style={row}>
        <ReviewStars rating={4} />
        <span style={meta}>Hampta Pass trek, Manali</span>
      </div>
      <div style={row}>
        <ReviewStars rating={3} />
        <span style={meta}>Goa scuba discovery dive</span>
      </div>
    </div>
  );
}

export function WithCount() {
  return (
    <div style={row}>
      <ReviewStars rating={4} />
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>4.6</span>
      <span style={meta}>(218 reviews)</span>
    </div>
  );
}
