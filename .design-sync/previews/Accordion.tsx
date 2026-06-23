import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "outvers-next";

const wrap: React.CSSProperties = {
  maxWidth: 460,
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "4px 16px",
  background: "var(--card)",
};

export function FAQ() {
  return (
    <div style={wrap}>
      <Accordion defaultValue={["cancellation"]}>
        <AccordionItem value="cancellation">
          <AccordionTrigger>What&apos;s the cancellation policy?</AccordionTrigger>
          <AccordionContent>
            Free cancellation up to 24 hours before your Triund trek start time
            for a full refund to your wallet.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="gear">
          <AccordionTrigger>Is gear included?</AccordionTrigger>
          <AccordionContent>
            Tents, sleeping bags and trekking poles are provided. Carry your own
            shoes and a warm layer for the Hampta Pass campsite.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="difficulty">
          <AccordionTrigger>What&apos;s the difficulty level?</AccordionTrigger>
          <AccordionContent>
            Moderate. Suitable for first-time trekkers with basic fitness; expect
            5–6 hours of walking per day.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
