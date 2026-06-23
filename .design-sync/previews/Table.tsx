import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  Badge,
} from "outvers-next";

export function BookingsTable() {
  return (
    <Table>
      <TableCaption>Your upcoming adventure bookings</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Experience</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Guests</TableHead>
          <TableHead style={{ textAlign: "right" }}>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell style={{ fontWeight: 500 }}>
            Rishikesh White-Water Rafting
          </TableCell>
          <TableCell>12 Oct, 9:00 AM</TableCell>
          <TableCell>2 adults</TableCell>
          <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ₹3,000
          </TableCell>
          <TableCell>
            <Badge variant="success">Confirmed</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell style={{ fontWeight: 500 }}>
            Bir Billing Paragliding
          </TableCell>
          <TableCell>14 Oct, 11:30 AM</TableCell>
          <TableCell>1 adult</TableCell>
          <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ₹3,200
          </TableCell>
          <TableCell>
            <Badge variant="warning">Pending payment</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell style={{ fontWeight: 500 }}>
            Goa Scuba Diving — Grande Island
          </TableCell>
          <TableCell>18 Oct, 7:00 AM</TableCell>
          <TableCell>2 adults, 1 child</TableCell>
          <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ₹8,400
          </TableCell>
          <TableCell>
            <Badge variant="info">Awaiting permit</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell style={{ fontWeight: 500 }}>
            Manali Solang Valley Trek
          </TableCell>
          <TableCell>21 Oct, 6:00 AM</TableCell>
          <TableCell>4 adults</TableCell>
          <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ₹6,000
          </TableCell>
          <TableCell>
            <Badge variant="success">Confirmed</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total (4 bookings)</TableCell>
          <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ₹20,600
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}
