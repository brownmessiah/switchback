-- Customer cart (home-redesign issue 11, ADR-0021 -- amends ADR-0008).
--
-- The cart is a SAVED LIST: at checkout (issue 12) each line becomes its own
-- independent Booking via createBooking, with its own authoritative
-- price/commission/tax snapshots. price_per_participant_snapshot here is the
-- DISPLAY snapshot taken at add time (M2 snapshot rule) -- never charged from.
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate).
-- MUST stay in lockstep with db/schema/carts.ts (the drizzle definition also
-- drives the e2e DB via drizzle-kit push).
CREATE TABLE IF NOT EXISTS "carts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "carts_customer_user_id_users_id_fk"
    FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "carts_one_per_customer" ON "carts" ("customer_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cart_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cart_id" uuid NOT NULL,
  "experience_id" uuid NOT NULL,
  "slot_id" uuid NOT NULL,
  "variation_id" uuid,
  "participant_count" integer NOT NULL,
  "price_per_participant_snapshot" numeric(12,2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cart_items_cart_id_carts_id_fk"
    FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE,
  CONSTRAINT "cart_items_experience_id_experiences_id_fk"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE,
  CONSTRAINT "cart_items_slot_id_availability_slots_id_fk"
    FOREIGN KEY ("slot_id") REFERENCES "availability_slots"("id") ON DELETE CASCADE,
  CONSTRAINT "cart_items_variation_id_experience_pricing_variations_id_fk"
    FOREIGN KEY ("variation_id") REFERENCES "experience_pricing_variations"("id") ON DELETE SET NULL,
  CONSTRAINT "cart_items_participants_bounds"
    CHECK ("participant_count" >= 1 AND "participant_count" <= 50),
  CONSTRAINT "cart_items_price_non_negative"
    CHECK ("price_per_participant_snapshot" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_one_per_slot" ON "cart_items" ("cart_id", "slot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_items_by_cart" ON "cart_items" ("cart_id");
