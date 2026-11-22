ALTER TABLE "push_tokens" DROP CONSTRAINT "push_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" DROP COLUMN "push_token";