import { ThemeToggle } from "outvers-next";

const frame: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: 8,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--card)",
  color: "var(--foreground)",
};

const label: React.CSSProperties = {
  fontSize: 14,
  color: "var(--muted-foreground)",
};

export function Toggle() {
  return (
    <div style={frame}>
      <ThemeToggle label="Toggle dark mode" />
      <span style={label}>Toggle theme</span>
    </div>
  );
}
