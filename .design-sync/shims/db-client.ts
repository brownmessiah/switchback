// design-sync shim: @/db/client. Bundled lib modules (experience-images,
// search-experiences) import `db` for async query helpers that previews never
// call — only their sync helpers (e.g. resolveExperienceCover) run. This stub
// keeps the postgres driver (and node built-ins) out of the browser bundle.
// The chain Proxy makes any accidental `db.select()...` an inert no-op instead
// of a throw.
const chain: any = new Proxy(function () { return chain; }, {
  get: () => chain,
  apply: () => chain,
});

export const db: any = chain;
export type DB = any;
