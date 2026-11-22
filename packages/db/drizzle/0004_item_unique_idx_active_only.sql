DROP INDEX "items_group_product_master_idx";--> statement-breakpoint
DROP INDEX "items_group_barcode_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "items_group_product_master_idx" ON "items" USING btree ("group_id","product_master_id") WHERE "items"."product_master_id" IS NOT NULL AND "items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "items_group_barcode_idx" ON "items" USING btree ("group_id","barcode") WHERE "items"."product_master_id" IS NULL AND "items"."barcode" IS NOT NULL AND "items"."deleted_at" IS NULL;