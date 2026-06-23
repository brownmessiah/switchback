// design-sync bundle entry. Re-exports exactly the curated design-system
// surface so esbuild bundles only client-safe components (server/DB/feature
// components are deliberately excluded). Every sub-part is re-exported so
// preview cards can compose compounds (Card + CardHeader, Select + SelectItem,
// ...) from window.OutversUI. The component LIST shown in the DS pane is driven
// by cfg.componentSrcMap, not by this file.

// ── UI primitives (components/ui) ──
export * from "@/components/ui/accordion";
export * from "@/components/ui/alert";
export * from "@/components/ui/avatar";
export * from "@/components/ui/badge";
export * from "@/components/ui/breadcrumb";
export * from "@/components/ui/button";
export * from "@/components/ui/card";
export * from "@/components/ui/dialog";
export * from "@/components/ui/dropdown-menu";
export * from "@/components/ui/input";
export * from "@/components/ui/label";
export * from "@/components/ui/progress";
export * from "@/components/ui/radio-group";
export * from "@/components/ui/select";
export * from "@/components/ui/separator";
export * from "@/components/ui/sheet";
export * from "@/components/ui/skeleton";
export * from "@/components/ui/table";
export * from "@/components/ui/tabs";
export * from "@/components/ui/textarea";
export * from "@/components/ui/toaster";
export * from "@/components/ui/tooltip";
export * from "@/components/ui/responsive-table";

// ── Curated feature components ──
export * from "@/components/experience-card";
export * from "@/components/booking-status-badge";
export * from "@/components/trust-badge";
export * from "@/components/reviews/review-stars";
export * from "@/components/empty-state";
export * from "@/components/dashboard-bookings-empty";
export * from "@/components/search/search-empty-state";
export * from "@/components/collection-page-skeleton";
export * from "@/components/home/how-it-works";
export * from "@/components/home/trust";
export * from "@/components/search/active-filter-chips";
export * from "@/components/search/view-toggle";
export * from "@/components/compare/toggle";
export * from "@/components/language-selector";
export * from "@/components/theme-toggle";
export * from "@/components/recently-viewed/rail";
