ALTER TABLE "core"."AutomationPolicy"
ADD COLUMN "max_source_posts_per_run" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "max_comments_per_source_post" INTEGER NOT NULL DEFAULT 10;
