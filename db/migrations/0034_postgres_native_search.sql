-- ADR-0019 / amends ADR-0013 -- Postgres-native search (retire Meilisearch).
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate). The
-- test harness execs each statement individually (split on the
-- statement-breakpoint marker); production applies via the same numbered-SQL path
-- (the tracked migration runner).
--
-- The customer `/search` `q` text query is now served by Postgres full-text
-- search (`tsvector` + GIN) over `title` + `short_description`, with `pg_trgm`
-- providing typo/fuzzy tolerance (`similarity()`), exactly as the rest of the
-- catalog already lives in this database. No second datastore, no index to keep
-- in sync. `lib/search/search-experiences.ts` builds the query; these indexes
-- make it fast. The FTS expression below MUST stay byte-for-byte identical to the
-- one in `search-experiences.ts` (same `'english'` config + coalesce order) or
-- the planner cannot use the index.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- Full-text search over title + short description. The expression matches the
-- `to_tsvector(...)` built in search-experiences.ts verbatim.
CREATE INDEX IF NOT EXISTS "experiences_fts_idx"
  ON "experiences"
  USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("short_description", '')));
--> statement-breakpoint
-- Trigram indexes backing `similarity()` typo tolerance + prefix `ILIKE`.
CREATE INDEX IF NOT EXISTS "experiences_title_trgm_idx"
  ON "experiences"
  USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiences_short_description_trgm_idx"
  ON "experiences"
  USING gin ("short_description" gin_trgm_ops);
