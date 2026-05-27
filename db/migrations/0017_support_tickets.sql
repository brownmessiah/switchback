DO $$ BEGIN
  CREATE TYPE "ticket_status" AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "ticket_priority" AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "ticket_category" AS ENUM ('booking', 'payment', 'experience', 'account', 'cancellation', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assigned_to_admin_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "subject" text NOT NULL,
  "status" "ticket_status" DEFAULT 'open' NOT NULL,
  "priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
  "category" "ticket_category" DEFAULT 'other' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "sender_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_by_status" ON "support_tickets" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_by_priority" ON "support_tickets" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_by_category" ON "support_tickets" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_by_creator" ON "support_tickets" USING btree ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_by_assignee" ON "support_tickets" USING btree ("assigned_to_admin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_by_ticket" ON "support_messages" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_by_sender" ON "support_messages" USING btree ("sender_user_id");
