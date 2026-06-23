import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
  Button,
  Badge,
} from "outvers-next";

export function Default() {
  return (
    <Card style={{ maxWidth: 380 }}>
      <CardHeader>
        <CardTitle>Sunrise Trek to Triund</CardTitle>
        <CardDescription>Dharamshala, Himachal Pradesh · 2 days</CardDescription>
        <CardAction>
          <Badge variant="success">Verified</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        A guided overnight trek through pine forest to the Triund ridge — camp
        under the stars with panoramic Dhauladhar views and a local mountain
        guide.
      </CardContent>
      <CardFooter style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600 }}>
          ₹2,499{" "}
          <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>
            / person
          </span>
        </span>
        <Button size="sm">Book</Button>
      </CardFooter>
    </Card>
  );
}

export function Compact() {
  return (
    <Card size="sm" style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>Scuba Discovery Dive</CardTitle>
        <CardDescription>Grande Island, Goa · 3 hours</CardDescription>
      </CardHeader>
      <CardContent>
        Beginner-friendly first dive — no certification needed, all gear
        included.
      </CardContent>
    </Card>
  );
}
