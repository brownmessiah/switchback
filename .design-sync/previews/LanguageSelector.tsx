import { LanguageSelector } from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  gap: 32,
  alignItems: "center",
  padding: 16,
};

export function Compact() {
  return (
    <div style={row}>
      <LanguageSelector variant="compact" />
    </div>
  );
}

export function Full() {
  return (
    <div style={row}>
      <LanguageSelector variant="full" />
    </div>
  );
}
