-- CreateTable
CREATE TABLE "core"."Account" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL DEFAULT 'My Workspace',
    "plan_id" TEXT NOT NULL DEFAULT 'FREE',
    "onboarding_state" TEXT NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Suggestion" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "comment_id" TEXT,
    "suggested_text" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "signals" TEXT NOT NULL,
    "owner_settings_snapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "context_type" TEXT,
    "speaker_role" TEXT,
    "template_category" TEXT,
    "automation_eligible" BOOLEAN DEFAULT false,
    "automation_reasons" TEXT DEFAULT '[]',
    "automation_checked_at" TIMESTAMP(3),

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."SuggestionDecision" (
    "id" TEXT NOT NULL,
    "suggestion_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "final_text" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."OwnerSettings" (
    "workspace_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'OBSERVE_ONLY',
    "aggressiveness" TEXT NOT NULL DEFAULT 'CONSERVATIVE',
    "enable_intents" TEXT NOT NULL DEFAULT '{}',
    "min_intent_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "platforms_enabled" TEXT NOT NULL DEFAULT '[]',
    "max_suggestions_per_day" INTEGER NOT NULL DEFAULT 20,
    "automation_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "max_suggestions_per_video" INTEGER NOT NULL DEFAULT 2,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "preferred_language" TEXT,
    "tone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerSettings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "core"."InstallRegistry" (
    "id" TEXT NOT NULL,
    "install_id" TEXT NOT NULL,
    "install_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" TEXT,

    CONSTRAINT "InstallRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."EngagementEvent" (
    "id" TEXT NOT NULL,
    "external_event_id" TEXT,
    "dedup_key" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3),
    "platform" TEXT NOT NULL,
    "target_id" TEXT NOT NULL DEFAULT 'unknown',
    "account_id" TEXT,
    "install_id" TEXT,
    "video_id" TEXT,
    "comment_id" TEXT,
    "content_text" TEXT,
    "metadata" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."SuggestionSession" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "input_snapshot" TEXT NOT NULL,
    "suggestion_text" TEXT NOT NULL,
    "brain_meta" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."FeedbackSignal" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "final_text" TEXT,
    "edit_distance" INTEGER,
    "time_to_action" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SUPERADMIN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."AdminSession" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."AuditLog" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "workspace_id" TEXT,
    "meta" TEXT,
    "ip" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "active_workspace_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_workspace_id_idx" ON "core"."Suggestion"("workspace_id");

-- CreateIndex
CREATE INDEX "Suggestion_event_id_idx" ON "core"."Suggestion"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionDecision_suggestion_id_key" ON "core"."SuggestionDecision"("suggestion_id");

-- CreateIndex
CREATE INDEX "OwnerSettings_workspace_id_idx" ON "core"."OwnerSettings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "InstallRegistry_install_id_key" ON "core"."InstallRegistry"("install_id");

-- CreateIndex
CREATE INDEX "InstallRegistry_account_id_idx" ON "core"."InstallRegistry"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_external_event_id_key" ON "core"."EngagementEvent"("external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_dedup_key_key" ON "core"."EngagementEvent"("dedup_key");

-- CreateIndex
CREATE INDEX "EngagementEvent_account_id_idx" ON "core"."EngagementEvent"("account_id");

-- CreateIndex
CREATE INDEX "EngagementEvent_install_id_idx" ON "core"."EngagementEvent"("install_id");

-- CreateIndex
CREATE INDEX "EngagementEvent_created_at_idx" ON "core"."EngagementEvent"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackSignal_session_id_key" ON "core"."FeedbackSignal"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "core"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "core"."AdminUser"("email");

-- CreateIndex
CREATE INDEX "AuditLog_workspace_id_created_at_idx" ON "core"."AuditLog"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_created_at_idx" ON "core"."AuditLog"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_correlation_id_idx" ON "core"."AuditLog"("correlation_id");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_workspace_id_idx" ON "core"."WorkspaceMembership"("workspace_id");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_user_id_idx" ON "core"."WorkspaceMembership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspace_id_user_id_key" ON "core"."WorkspaceMembership"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "Session_user_id_idx" ON "core"."Session"("user_id");

-- CreateIndex
CREATE INDEX "Session_active_workspace_id_idx" ON "core"."Session"("active_workspace_id");

-- AddForeignKey
ALTER TABLE "core"."Suggestion" ADD CONSTRAINT "Suggestion_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Suggestion" ADD CONSTRAINT "Suggestion_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "core"."EngagementEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."SuggestionDecision" ADD CONSTRAINT "SuggestionDecision_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "core"."Suggestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."SuggestionDecision" ADD CONSTRAINT "SuggestionDecision_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."SuggestionDecision" ADD CONSTRAINT "SuggestionDecision_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."OwnerSettings" ADD CONSTRAINT "OwnerSettings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."InstallRegistry" ADD CONSTRAINT "InstallRegistry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "core"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EngagementEvent" ADD CONSTRAINT "EngagementEvent_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "core"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."SuggestionSession" ADD CONSTRAINT "SuggestionSession_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "core"."EngagementEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."FeedbackSignal" ADD CONSTRAINT "FeedbackSignal_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "core"."SuggestionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."AdminSession" ADD CONSTRAINT "AdminSession_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "core"."AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Session" ADD CONSTRAINT "Session_active_workspace_id_fkey" FOREIGN KEY ("active_workspace_id") REFERENCES "core"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
