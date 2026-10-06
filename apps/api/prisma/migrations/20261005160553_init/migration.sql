-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'LEFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrolmentOutcome" AS ENUM ('PROMOTED', 'REPEATING', 'LEFT');

-- CreateEnum
CREATE TYPE "AnomalyType" AS ENUM ('ABSENCE', 'TARDINESS');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('HOLIDAY', 'MEETING', 'EXAM', 'EVENT');

-- CreateEnum
CREATE TYPE "TemplatePurpose" AS ENUM ('TARDINESS', 'ABSENCE', 'PAYMENT', 'CALENDAR', 'GENERAL');

-- CreateEnum
CREATE TYPE "MetaCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "MetaStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DispatchSource" AS ENUM ('MANUAL', 'ATTENDANCE', 'CALENDAR', 'FEE_RULE');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('AWAITING_CONFIRMATION', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_FAILURES', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'RETRY_PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DISPATCH_FAILURES', 'AWAITING_CONFIRMATION', 'TEMPLATE_REJECTED', 'IMPORT_DONE');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('STUDENTS', 'PAYMENTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "admin_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT '',
    "academic_year_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "id" UUID NOT NULL,
    "matricule" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrolment" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "outcome" "EnrolmentOutcome",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_contact" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT '',
    "phone_e164" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_masked" TEXT NOT NULL,
    "consent_at" DATE,
    "is_opted_out" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parent_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_anomaly" (
    "id" UUID NOT NULL,
    "enrolment_id" UUID NOT NULL,
    "type" "AnomalyType" NOT NULL,
    "date" DATE NOT NULL,
    "subject_id" UUID,
    "time_slot" TEXT,
    "arrival_time" TEXT,
    "note" TEXT,
    "is_justified" BOOLEAN NOT NULL DEFAULT false,
    "justification_note" TEXT,
    "recorded_by" UUID,
    "message_dispatch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_time" TEXT,
    "place" TEXT,
    "description" TEXT,
    "recipient_filter" JSONB NOT NULL,
    "template_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_trigger" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "days_offset" INTEGER NOT NULL,
    "send_time" TEXT NOT NULL,
    "dispatch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_installment" (
    "id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "default_amount_xaf" INTEGER NOT NULL,
    "class_amounts" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fee" (
    "id" UUID NOT NULL,
    "enrolment_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "amount_due_xaf" INTEGER NOT NULL,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "student_fee_id" UUID NOT NULL,
    "amount_xaf" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "reference" TEXT,
    "import_job_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_reminder_rule" (
    "id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "days_offset" INTEGER NOT NULL,
    "send_time" TEXT NOT NULL,
    "recipient_filter" JSONB NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "dispatch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_reminder_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "meta_name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "meta_category" "MetaCategory" NOT NULL,
    "purpose" "TemplatePurpose" NOT NULL,
    "body_preview" TEXT NOT NULL,
    "parameter_map" JSONB NOT NULL DEFAULT '[]',
    "meta_status" "MetaStatus" NOT NULL DEFAULT 'PENDING',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "template_id" UUID NOT NULL,
    "purpose" "TemplatePurpose" NOT NULL,
    "source" "DispatchSource" NOT NULL,
    "recipient_filter" JSONB NOT NULL,
    "fixed_parameters" JSONB NOT NULL DEFAULT '{}',
    "status" "DispatchStatus" NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "estimated_cost_xaf" INTEGER NOT NULL DEFAULT 0,
    "students_count" INTEGER NOT NULL DEFAULT 0,
    "messages_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "parent_contact_id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_masked" TEXT NOT NULL,
    "rendered_parameters" JSONB NOT NULL,
    "wamid" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '',
    "group_key" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_created" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "preview" JSONB NOT NULL DEFAULT '{}',
    "error_file" BYTEA,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" UUID NOT NULL,
    "body" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_email_key" ON "admin_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_label_key" ON "academic_year"("label");

-- CreateIndex
CREATE UNIQUE INDEX "department_name_key" ON "department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "class_academic_year_id_name_key" ON "class"("academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subject_name_key" ON "subject"("name");

-- CreateIndex
CREATE UNIQUE INDEX "student_matricule_key" ON "student"("matricule");

-- CreateIndex
CREATE INDEX "student_last_name_first_name_idx" ON "student"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "enrolment_class_id_idx" ON "enrolment"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolment_student_id_academic_year_id_key" ON "enrolment"("student_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "parent_contact_phone_hash_idx" ON "parent_contact"("phone_hash");

-- CreateIndex
CREATE INDEX "parent_contact_student_id_idx" ON "parent_contact"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_anomaly_message_dispatch_id_key" ON "attendance_anomaly"("message_dispatch_id");

-- CreateIndex
CREATE INDEX "attendance_anomaly_date_idx" ON "attendance_anomaly"("date");

-- CreateIndex
CREATE INDEX "attendance_anomaly_enrolment_id_idx" ON "attendance_anomaly"("enrolment_id");

-- CreateIndex
CREATE INDEX "calendar_event_start_date_idx" ON "calendar_event"("start_date");

-- CreateIndex
CREATE UNIQUE INDEX "event_trigger_dispatch_id_key" ON "event_trigger"("dispatch_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_installment_academic_year_id_name_key" ON "fee_installment"("academic_year_id", "name");

-- CreateIndex
CREATE INDEX "student_fee_installment_id_idx" ON "student_fee"("installment_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_fee_enrolment_id_installment_id_key" ON "student_fee"("enrolment_id", "installment_id");

-- CreateIndex
CREATE INDEX "payment_student_fee_id_idx" ON "payment"("student_fee_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_reminder_rule_dispatch_id_key" ON "fee_reminder_rule"("dispatch_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_meta_name_language_key" ON "message_template"("meta_name", "language");

-- CreateIndex
CREATE INDEX "dispatch_status_scheduled_for_idx" ON "dispatch"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "dispatch_created_at_idx" ON "dispatch"("created_at");

-- CreateIndex
CREATE INDEX "message_wamid_idx" ON "message"("wamid");

-- CreateIndex
CREATE INDEX "message_status_idx" ON "message"("status");

-- CreateIndex
CREATE INDEX "message_student_id_idx" ON "message"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_dispatch_id_student_id_parent_contact_id_key" ON "message"("dispatch_id", "student_id", "parent_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_group_key_key" ON "notification"("group_key");

-- CreateIndex
CREATE INDEX "notification_is_read_created_at_idx" ON "notification"("is_read", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "class" ADD CONSTRAINT "class_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class" ADD CONSTRAINT "class_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contact" ADD CONSTRAINT "parent_contact_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_anomaly" ADD CONSTRAINT "attendance_anomaly_enrolment_id_fkey" FOREIGN KEY ("enrolment_id") REFERENCES "enrolment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_anomaly" ADD CONSTRAINT "attendance_anomaly_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_anomaly" ADD CONSTRAINT "attendance_anomaly_message_dispatch_id_fkey" FOREIGN KEY ("message_dispatch_id") REFERENCES "dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_trigger" ADD CONSTRAINT "event_trigger_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_trigger" ADD CONSTRAINT "event_trigger_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_installment" ADD CONSTRAINT "fee_installment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee" ADD CONSTRAINT "student_fee_enrolment_id_fkey" FOREIGN KEY ("enrolment_id") REFERENCES "enrolment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee" ADD CONSTRAINT "student_fee_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "fee_installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_student_fee_id_fkey" FOREIGN KEY ("student_fee_id") REFERENCES "student_fee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_reminder_rule" ADD CONSTRAINT "fee_reminder_rule_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "fee_installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_reminder_rule" ADD CONSTRAINT "fee_reminder_rule_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_parent_contact_id_fkey" FOREIGN KEY ("parent_contact_id") REFERENCES "parent_contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one academic year is active at a time (FR-ORG-001).
CREATE UNIQUE INDEX "academic_year_one_active" ON "academic_year" ("is_active") WHERE "is_active";
