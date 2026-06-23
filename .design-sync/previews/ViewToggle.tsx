import { ViewToggle } from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  gap: 24,
  alignItems: "center",
  padding: 16,
};

export function GridActive() {
  return (
    <div style={row}>
      <ViewToggle current="grid" gridLabel="Grid view" listLabel="List view" />
    </div>
  );
}

export function ListActive() {
  return (
    <div style={row}>
      <ViewToggle current="list" gridLabel="Grid view" listLabel="List view" />
    </div>
  );
}
