import { Tabs, TabsList, TabsTrigger, TabsContent } from "outvers-next";

const wrap: React.CSSProperties = {
  maxWidth: 480,
};

const panel: React.CSSProperties = {
  padding: "12px 2px",
  color: "var(--muted-foreground)",
  lineHeight: 1.5,
};

export function Panels() {
  return (
    <div style={wrap}>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div style={panel}>
            A 2-day guided trek to Triund with panoramic Dhauladhar views,
            overnight camping and all meals. Departs from Manali.
          </div>
        </TabsContent>
        <TabsContent value="itinerary">
          <div style={panel}>
            Day 1: McLeodganj to Triund ridge (₹2,800). Day 2: sunrise at the
            campsite, descent and return transfer.
          </div>
        </TabsContent>
        <TabsContent value="reviews">
          <div style={panel}>
            4.8 / 5 from 312 trekkers — &ldquo;Stunning views and a superb guide.
            Worth every rupee.&rdquo;
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
