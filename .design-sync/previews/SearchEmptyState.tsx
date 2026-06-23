import { SearchEmptyState } from "outvers-next";

const center: React.CSSProperties = {
  maxWidth: 520,
  margin: "0 auto",
};

const labels = {
  title: "No experiences match your search",
  hint: "We couldn’t find any trips for “kayaking in Ladakh”. Try clearing filters or one of these popular searches.",
  clearFilters: "Clear filters",
  alternativesLabel: "Popular searches",
  browseDestinations: "Browse nearby destinations",
};

export function FilteredWithAlternatives() {
  return (
    <div style={center}>
      <SearchEmptyState
        labels={labels}
        isFiltered
        alternatives={[
          { key: "rishikesh:rafting", href: "/search", label: "Rishikesh Rafting" },
          { key: "manali:trekking", href: "/search", label: "Manali Trekking" },
          { key: "goa:scuba", href: "/search", label: "Goa Scuba Diving" },
        ]}
      />
    </div>
  );
}

export function UnfilteredNoAlternatives() {
  return (
    <div style={center}>
      <SearchEmptyState labels={labels} isFiltered={false} alternatives={[]} />
    </div>
  );
}
