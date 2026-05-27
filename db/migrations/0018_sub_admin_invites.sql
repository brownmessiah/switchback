CREATE TABLE IF NOT EXISTS "sub_admin_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "permissions" text[] DEFAULT '{}' NOT NULL,
  "invited_by_admin_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text UNIQUE NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_admin_invites_by_email" ON "sub_admin_invites" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_admin_invites_by_status" ON "sub_admin_invites" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_admin_invites_by_inviter" ON "sub_admin_invites" USING btree ("invited_by_admin_id");
