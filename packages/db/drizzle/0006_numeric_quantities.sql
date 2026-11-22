ALTER TABLE "product_masters" ALTER COLUMN "content_amount" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "shopping_list_items" ALTER COLUMN "quantity" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "stock_events" ALTER COLUMN "quantity_delta" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "stocks" ALTER COLUMN "quantity" SET DATA TYPE numeric(12, 3);