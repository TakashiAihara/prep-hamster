CREATE TABLE "item_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"storage_deleted_at" timestamp with time zone,
	CONSTRAINT "item_photos_byte_size_positive" CHECK ("item_photos"."byte_size" > 0),
	CONSTRAINT "item_photos_status_check" CHECK ("item_photos"."status" IN ('pending', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_photos_item_idx" ON "item_photos" USING btree ("item_id","created_at","id");--> statement-breakpoint
CREATE INDEX "item_photos_ready_cover_idx" ON "item_photos" USING btree ("group_id","item_id","created_at","id") WHERE "item_photos"."deleted_at" IS NULL AND "item_photos"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "item_photos_stale_pending_idx" ON "item_photos" USING btree ("updated_at") WHERE "item_photos"."status" = 'pending' AND "item_photos"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "item_photos_pending_removal_idx" ON "item_photos" USING btree ("deleted_at") WHERE "item_photos"."deleted_at" IS NOT NULL AND "item_photos"."storage_deleted_at" IS NULL;--> statement-breakpoint
-- 0003 の RLS は、その時点にあった表だけを対象にしたループ。後から足した表は自分で閉じる (policy は置かない)。
ALTER TABLE "item_photos" ENABLE ROW LEVEL SECURITY;
