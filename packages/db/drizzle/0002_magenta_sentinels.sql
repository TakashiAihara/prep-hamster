CREATE TABLE "expiry_notifications" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notified_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expiry_notifications" ADD CONSTRAINT "expiry_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;