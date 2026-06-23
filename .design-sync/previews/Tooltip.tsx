import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Button,
} from "outvers-next";

const wrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "48px 24px",
};

export function FreeCancellation() {
  return (
    <div style={wrap}>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger render={<Button variant="outline" />}>
            Free cancellation
          </TooltipTrigger>
          <TooltipContent side="top">
            Cancel up to 24h before the start time for a full refund.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
