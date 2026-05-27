-- Notification type enum
CREATE TYPE "notification_type" AS ENUM (
  'booking_created',
  'booking_cancelled',
  'booking_completed',
  'review_posted',
  'payout_processed',
  'listing_approved',
  'listing_rejected',
  'message_received'
);
--> statement-breakpoint

-- Notification delivery channel enum
CREATE TYPE "notification_channel" AS ENUM (
  'in_app',
  'email',
  'whatsapp',
  'sms'
);
--> statement-breakpoint

-- Outbox delivery status enum
CREATE TYPE "outbox_status" AS ENUM (
  'pending',
  'sent',
  'failed',
  'skipped'
);
--> statement-breakpoint

-- Conversation status enum
CREATE TYPE "conversation_status" AS ENUM (
  'active',
  'archived'
);
--> statement-breakpoint

-- notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "notification_type" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "link" text,
  "event_id" text UNIQUE,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notifications_by_user" ON "notifications" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_by_user_unread" ON "notifications" ("user_id", "read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_by_event_id" ON "notifications" ("event_id");
--> statement-breakpoint

-- notification_outbox table
CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "channel" "notification_channel" NOT NULL,
  "status" "outbox_status" DEFAULT 'pending' NOT NULL,
  "attempted_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outbox_by_notification" ON "notification_outbox" ("notification_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_by_status" ON "notification_outbox" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_pending_channel" ON "notification_outbox" ("channel", "status");
--> statement-breakpoint

-- notification_preferences table
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_prefs_unique" UNIQUE ("user_id", "event_type", "channel")
);
--> statement-breakpoint

-- conversations table
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "customer_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL,
  "subject" text NOT NULL,
  "status" "conversation_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conversations_by_vendor" ON "conversations" ("vendor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_by_customer" ON "conversations" ("customer_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_by_booking" ON "conversations" ("booking_id");
--> statement-breakpoint

-- messages table
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "sender_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_by_conversation" ON "messages" ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_by_sender" ON "messages" ("sender_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_by_conversation_time" ON "messages" ("conversation_id", "created_at");
