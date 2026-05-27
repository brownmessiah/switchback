CREATE TABLE IF NOT EXISTS "site_content" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "section" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "locale" text DEFAULT 'en' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_admin_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_content_section_key_locale_uq" ON "site_content" USING btree ("section","key","locale");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_content_by_section" ON "site_content" USING btree ("section");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_content_by_locale" ON "site_content" USING btree ("locale");
