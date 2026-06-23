-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "brand_color" TEXT,
    "contact_email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "website_slug" TEXT,
    "website_enabled" BOOLEAN NOT NULL DEFAULT false,
    "website_settings" JSONB NOT NULL DEFAULT '{}',
    "carrier_runner_settings" JSONB NOT NULL DEFAULT '{}',
    "service_areas" JSONB NOT NULL DEFAULT '[]',
    "agency_code_hash" TEXT,
    "agency_code_preview" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'starter',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowed_users" INTEGER NOT NULL DEFAULT 3,
    "allowed_prospects_per_month" INTEGER NOT NULL DEFAULT 100,
    "allowed_ai_messages_per_month" INTEGER NOT NULL DEFAULT 500,
    "allowed_carriers" INTEGER NOT NULL DEFAULT 10,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "billing_settings" JSONB NOT NULL DEFAULT '{}',
    "performance_settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMP(3),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "profile" JSONB NOT NULL DEFAULT '{}',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "client_code" TEXT,
    "line_of_business" TEXT,
    "business_name" TEXT,
    "operations_description" TEXT,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "mailing_address" TEXT,
    "additional_contacts" JSONB NOT NULL DEFAULT '[]',
    "marketing_opt_in_email" BOOLEAN NOT NULL DEFAULT false,
    "marketing_opt_in_sms" BOOLEAN NOT NULL DEFAULT false,
    "consent_trail" JSONB NOT NULL DEFAULT '{}',
    "assigned_agent_id" TEXT,
    "assigned_csr_id" TEXT,
    "additional_agent_ids" JSONB NOT NULL DEFAULT '[]',
    "additional_csr_ids" JSONB NOT NULL DEFAULT '[]',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "estimated_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "carrier_id" TEXT,
    "policy_number" TEXT,
    "premium_estimate" DECIMAL(14,2),
    "final_premium" DECIMAL(14,2),
    "effective_date" TIMESTAMP(3),
    "renewal_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "renewal_status" TEXT,
    "agent_id" TEXT,
    "department" TEXT,
    "billing" JSONB NOT NULL DEFAULT '{}',
    "coverages" JSONB NOT NULL DEFAULT '[]',
    "endorsements" JSONB NOT NULL DEFAULT '[]',
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "parties" JSONB NOT NULL DEFAULT '{}',
    "premium_breakdown" JSONB NOT NULL DEFAULT '{}',
    "carrier_binding" JSONB NOT NULL DEFAULT '{}',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_associated_addresses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_associated_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carriers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "state" TEXT,
    "appetite" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_agency_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_agency_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" TEXT,
    "name" TEXT NOT NULL,
    "username_preview" TEXT,
    "encrypted_payload" JSONB NOT NULL,
    "encryption_key_ref" TEXT,
    "mfa_mode" TEXT,
    "authorized_user_ids" JSONB NOT NULL DEFAULT '[]',
    "last_verified_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "document_name" TEXT,
    "type" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storage_path" TEXT NOT NULL,
    "download_url" TEXT,
    "line_of_business" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "template_fields" JSONB NOT NULL DEFAULT '{}',
    "template_field_layout" JSONB NOT NULL DEFAULT '[]',
    "fillable_detection" JSONB NOT NULL DEFAULT '{}',
    "customer_id" TEXT,
    "asset_id" TEXT,
    "policy_id" TEXT,
    "claim_id" TEXT,
    "carrier_id" TEXT,
    "quote_request_id" TEXT,
    "esign" JSONB NOT NULL DEFAULT '{}',
    "renewal" JSONB NOT NULL DEFAULT '{}',
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "prospect_id" TEXT,
    "carrier_contact_id" TEXT,
    "external_recipient_name" TEXT,
    "external_recipient_email" TEXT,
    "external_recipient_role" TEXT,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT,
    "thread_id" TEXT,
    "reply_to_id" TEXT,
    "mailbox" JSONB NOT NULL DEFAULT '{}',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL,
    "resolution" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quoting_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_request_id" TEXT,
    "category_id" TEXT,
    "category_label" TEXT,
    "prospect_id" TEXT,
    "customer_id" TEXT,
    "asset_id" TEXT,
    "asset_type" TEXT NOT NULL,
    "estimated_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "asset_details" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT,
    "line_of_business" TEXT,
    "commercial_acord_templates" JSONB NOT NULL DEFAULT '[]',
    "questionnaire_questions" JSONB NOT NULL DEFAULT '[]',
    "questionnaire_responses" JSONB NOT NULL DEFAULT '{}',
    "questionnaire_response_meta" JSONB NOT NULL DEFAULT '{}',
    "carrier_submissions" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "public_fields" JSONB NOT NULL DEFAULT '{}',
    "public_field_evidence" JSONB NOT NULL DEFAULT '{}',
    "missing_fields" JSONB NOT NULL DEFAULT '[]',
    "questionnaire_message_id" TEXT,
    "questionnaire_draft" TEXT,
    "questionnaire_sent_at" TIMESTAMP(3),
    "reply_received_at" TIMESTAMP(3),
    "quotes" JSONB NOT NULL DEFAULT '[]',
    "ai_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quoting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "customer_id" TEXT,
    "prospect_id" TEXT,
    "asset_id" TEXT,
    "policy_id" TEXT,
    "quote_session_id" TEXT,
    "quote_request_id" TEXT,
    "document_id" TEXT,
    "message_id" TEXT,
    "communication_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "assigned_to_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" TEXT,
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quote_session_id" TEXT,
    "quote_request_id" TEXT,
    "customer_id" TEXT,
    "prospect_id" TEXT,
    "asset_id" TEXT,
    "policy_id" TEXT,
    "claim_id" TEXT,
    "document_id" TEXT,
    "message_id" TEXT,
    "source" TEXT NOT NULL,
    "activity_key" TEXT,
    "source_notification_id" TEXT,
    "topic" TEXT,
    "ai_summary" TEXT,
    "original_message_content" TEXT,
    "original_message_id" TEXT,
    "ai_reply_body" TEXT,
    "ai_reply_subject" TEXT,
    "severity" TEXT,
    "severity_reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_to_id" TEXT,
    "additional_assigned_to_ids" JSONB NOT NULL DEFAULT '[]',
    "due_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "created_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "started_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "resolution" JSONB NOT NULL DEFAULT '{}',
    "routing" JSONB NOT NULL DEFAULT '{}',
    "priority_rank" INTEGER,
    "queue_position" DECIMAL(14,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "carrier_id" TEXT,
    "external_claim_number" TEXT,
    "loss_description" TEXT,
    "loss_amount_usd" DECIMAL(14,2),
    "status" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "prospect_id" TEXT,
    "policy_id" TEXT,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "policy_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "policy_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "provider_ref" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotex_app_state" (
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotex_app_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agencies_active_idx" ON "agencies"("active");

-- CreateIndex
CREATE INDEX "agencies_website_slug_idx" ON "agencies"("website_slug");

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "customer_profiles_tenant_id_idx" ON "customer_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "customer_profiles_tenant_id_branch_id_idx" ON "customer_profiles"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "customer_profiles_tenant_id_assigned_agent_id_idx" ON "customer_profiles"("tenant_id", "assigned_agent_id");

-- CreateIndex
CREATE INDEX "customer_profiles_tenant_id_assigned_csr_id_idx" ON "customer_profiles"("tenant_id", "assigned_csr_id");

-- CreateIndex
CREATE INDEX "customer_profiles_tenant_id_archived_idx" ON "customer_profiles"("tenant_id", "archived");

-- CreateIndex
CREATE INDEX "assets_tenant_id_idx" ON "assets"("tenant_id");

-- CreateIndex
CREATE INDEX "assets_tenant_id_customer_id_idx" ON "assets"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "assets_tenant_id_type_idx" ON "assets"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "policies_tenant_id_idx" ON "policies"("tenant_id");

-- CreateIndex
CREATE INDEX "policies_tenant_id_customer_id_idx" ON "policies"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "policies_tenant_id_asset_id_idx" ON "policies"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "policies_tenant_id_carrier_id_idx" ON "policies"("tenant_id", "carrier_id");

-- CreateIndex
CREATE INDEX "policies_tenant_id_renewal_date_idx" ON "policies"("tenant_id", "renewal_date");

-- CreateIndex
CREATE INDEX "policy_associated_addresses_tenant_id_idx" ON "policy_associated_addresses"("tenant_id");

-- CreateIndex
CREATE INDEX "policy_associated_addresses_tenant_id_policy_id_idx" ON "policy_associated_addresses"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "carriers_tenant_id_idx" ON "carriers"("tenant_id");

-- CreateIndex
CREATE INDEX "carriers_name_idx" ON "carriers"("name");

-- CreateIndex
CREATE INDEX "carrier_agency_links_tenant_id_idx" ON "carrier_agency_links"("tenant_id");

-- CreateIndex
CREATE INDEX "carrier_agency_links_tenant_id_active_idx" ON "carrier_agency_links"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "carrier_agency_links_carrier_id_idx" ON "carrier_agency_links"("carrier_id");

-- CreateIndex
CREATE INDEX "carrier_credentials_tenant_id_idx" ON "carrier_credentials"("tenant_id");

-- CreateIndex
CREATE INDEX "carrier_credentials_tenant_id_carrier_id_idx" ON "carrier_credentials"("tenant_id", "carrier_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_customer_id_idx" ON "documents"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_policy_id_idx" ON "documents"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_type_idx" ON "documents"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "documents_tenant_id_visibility_idx" ON "documents"("tenant_id", "visibility");

-- CreateIndex
CREATE INDEX "communications_tenant_id_idx" ON "communications"("tenant_id");

-- CreateIndex
CREATE INDEX "communications_tenant_id_customer_id_idx" ON "communications"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "communications_tenant_id_prospect_id_idx" ON "communications"("tenant_id", "prospect_id");

-- CreateIndex
CREATE INDEX "communications_tenant_id_thread_id_idx" ON "communications"("tenant_id", "thread_id");

-- CreateIndex
CREATE INDEX "communications_tenant_id_created_at_idx" ON "communications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "quoting_sessions_tenant_id_idx" ON "quoting_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "quoting_sessions_tenant_id_customer_id_idx" ON "quoting_sessions"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "quoting_sessions_tenant_id_status_idx" ON "quoting_sessions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "quoting_sessions_tenant_id_created_at_idx" ON "quoting_sessions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_notifications_tenant_id_idx" ON "ai_notifications"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_notifications_tenant_id_assigned_to_id_idx" ON "ai_notifications"("tenant_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "ai_notifications_tenant_id_acknowledged_at_idx" ON "ai_notifications"("tenant_id", "acknowledged_at");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_idx" ON "tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_idx" ON "tasks"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assigned_to_id_idx" ON "tasks"("tenant_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_due_at_idx" ON "tasks"("tenant_id", "due_at");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_queue_position_idx" ON "tasks"("tenant_id", "queue_position");

-- CreateIndex
CREATE INDEX "claims_tenant_id_idx" ON "claims"("tenant_id");

-- CreateIndex
CREATE INDEX "claims_tenant_id_customer_id_idx" ON "claims"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "claims_tenant_id_policy_id_idx" ON "claims"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "notes_tenant_id_idx" ON "notes"("tenant_id");

-- CreateIndex
CREATE INDEX "notes_tenant_id_customer_id_idx" ON "notes"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "notes_tenant_id_policy_id_idx" ON "notes"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "deposits_tenant_id_idx" ON "deposits"("tenant_id");

-- CreateIndex
CREATE INDEX "deposits_tenant_id_customer_id_idx" ON "deposits"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_idx" ON "payments"("tenant_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_customer_id_idx" ON "payments"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_status_idx" ON "payments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_associated_addresses" ADD CONSTRAINT "policy_associated_addresses_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_agency_links" ADD CONSTRAINT "carrier_agency_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_agency_links" ADD CONSTRAINT "carrier_agency_links_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_credentials" ADD CONSTRAINT "carrier_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_credentials" ADD CONSTRAINT "carrier_credentials_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoting_sessions" ADD CONSTRAINT "quoting_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoting_sessions" ADD CONSTRAINT "quoting_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_notifications" ADD CONSTRAINT "ai_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_notifications" ADD CONSTRAINT "ai_notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase hardening -------------------------------------------------
-- QuoteX production traffic should go through the server API. The
-- browser roles are deliberately denied direct table access until a
-- narrower Supabase Auth/RLS policy is intentionally introduced.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agencies',
    'branches',
    'users',
    'customer_profiles',
    'assets',
    'policies',
    'policy_associated_addresses',
    'carriers',
    'carrier_agency_links',
    'carrier_credentials',
    'documents',
    'communications',
    'quoting_sessions',
    'ai_notifications',
    'tasks',
    'claims',
    'notes',
    'deposits',
    'payments',
    'audit_logs',
    'quotex_app_state'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agencies',
    'branches',
    'users',
    'customer_profiles',
    'assets',
    'policies',
    'policy_associated_addresses',
    'carriers',
    'carrier_agency_links',
    'carrier_credentials',
    'documents',
    'communications',
    'quoting_sessions',
    'ai_notifications',
    'tasks',
    'claims',
    'notes',
    'deposits',
    'payments',
    'quotex_app_state'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX "users_tenant_id_lower_email_unique"
  ON "users"("tenant_id", lower("email"));

CREATE UNIQUE INDEX "customer_profiles_tenant_id_lower_email_unique"
  ON "customer_profiles"("tenant_id", lower("email"));
