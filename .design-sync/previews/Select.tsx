import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "outvers-next";

export function SortBy() {
  return (
    <Select defaultValue="recommended" defaultOpen>
      <SelectTrigger style={{ minWidth: 220 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="recommended">Recommended</SelectItem>
        <SelectItem value="price-low">Price: low to high</SelectItem>
        <SelectItem value="price-high">Price: high to low</SelectItem>
        <SelectItem value="rating">Top rated</SelectItem>
        <SelectItem value="newest">Newest</SelectItem>
      </SelectContent>
    </Select>
  );
}
