import { Progress, ProgressLabel, ProgressValue } from "outvers-next";

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  width: 360,
};

export function WithLabel() {
  return (
    <div style={stack}>
      <Progress value={72}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <ProgressLabel>Profile completeness</ProgressLabel>
          <ProgressValue />
        </div>
      </Progress>
    </div>
  );
}

export function Steps() {
  return (
    <div style={stack}>
      <Progress value={25} />
      <Progress value={50} />
      <Progress value={90} />
    </div>
  );
}
