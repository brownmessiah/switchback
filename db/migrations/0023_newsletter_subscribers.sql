CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "source" text,
  "locale" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_unique" ON "newsletter_subscribers" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_by_created" ON "newsletter_subscribers" USING btree ("created_at");
