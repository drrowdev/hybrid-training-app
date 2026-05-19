CREATE TYPE "public"."limitation_severity" AS ENUM('mild', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('foot_ankle_calf', 'knee', 'hamstring_posterior', 'adductor_groin', 'lumbar_trunk', 'shoulder_scapular', 'elbow_forearm');--> statement-breakpoint
CREATE TYPE "public"."interference_cost" AS ENUM('very_low', 'low', 'low_moderate', 'moderate', 'moderate_high', 'high', 'variable');--> statement-breakpoint
CREATE TABLE "limitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"region" "region" NOT NULL,
	"severity" "limitation_severity" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notes" text,
	"adjustments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"pattern" text NOT NULL,
	"primary_region" "region" NOT NULL,
	"secondary_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment" text,
	"is_compound" boolean DEFAULT false NOT NULL,
	"interference_cost" "interference_cost" DEFAULT 'low',
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"bodyweight_kg" numeric(6, 2),
	"intake" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
