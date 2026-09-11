CREATE INDEX "activity_blocks_trip_day_position_idx" ON "activity_blocks" USING btree ("trip_id","day_id","position");--> statement-breakpoint
CREATE INDEX "activity_log_trip_created_idx" ON "activity_log" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "expenses_trip_id_idx" ON "expenses" USING btree ("trip_id");