import { z } from 'zod';
import {
  ANOMALY_TYPES,
  ENROLMENT_OUTCOMES,
  EVENT_TYPES,
  META_CATEGORIES,
  TEMPLATE_PURPOSES,
} from './enums';

// Request bodies for the /api/v1 REST API (SRS §8). Shared by the API (validation)
// and the web app (types).

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const time = z.string().regex(/^\d{1,2}:\d{2}$/, 'Heure attendue au format HH:MM');
const nonEmpty = z.string().trim().min(1, 'Champ obligatoire');

// --- Auth & administrators -------------------------------------------------
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
export const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: nonEmpty,
  password: z.string().min(8, 'Au moins 8 caractères'),
});
export const updateAdminSchema = z.object({ fullName: nonEmpty.optional(), isActive: z.boolean().optional() });
export const resetPasswordSchema = z.object({ password: z.string().min(8, 'Au moins 8 caractères') });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Au moins 8 caractères'),
});

// --- School setup ------------------------------------------------------------
export const academicYearSchema = z
  .object({ label: nonEmpty, startDate: day, endDate: day })
  .refine((v) => v.endDate > v.startDate, { message: 'La date de fin doit suivre la date de début', path: ['endDate'] });
export const departmentSchema = z.object({ name: nonEmpty });
export const classSchema = z.object({ name: nonEmpty, level: z.string().trim().default(''), departmentId: uuid });
export const subjectSchema = z.object({ name: nonEmpty, isActive: z.boolean().default(true) });

// --- Students & contacts -----------------------------------------------------
export const contactSchema = z.object({
  name: nonEmpty,
  relationship: z.string().trim().default(''),
  phone: nonEmpty,
  consentAt: day.optional(),
  isOptedOut: z.boolean().default(false),
});
export const createStudentSchema = z.object({
  matricule: nonEmpty,
  firstName: nonEmpty,
  lastName: nonEmpty,
  classId: uuid,
  contacts: z.array(contactSchema).default([]),
});
export const updateStudentSchema = z.object({
  matricule: nonEmpty.optional(),
  firstName: nonEmpty.optional(),
  lastName: nonEmpty.optional(),
  classId: uuid.optional(),
  status: z.enum(['ACTIVE', 'LEFT', 'ARCHIVED']).optional(),
});
export const updateContactSchema = contactSchema.partial();

// --- Recipient filter (FR-FLT, §8.2) -------------------------------------------
export const recipientFilterSchema = z.object({
  whole_school: z.boolean().default(false),
  department_ids: z.array(uuid).default([]),
  class_ids: z.array(uuid).default([]),
  student_ids: z.array(uuid).default([]),
  exclude_student_ids: z.array(uuid).default([]),
  fee_installment_unpaid: uuid.nullable().default(null),
});
export type RecipientFilter = z.infer<typeof recipientFilterSchema>;
export const emptyFilter = (): RecipientFilter => recipientFilterSchema.parse({});

// --- Dispatches ---------------------------------------------------------------
export const dispatchPreviewSchema = z.object({
  template_id: uuid,
  parameters: z.record(z.string()).default({}),
  recipients_filter: recipientFilterSchema,
});
export const createDispatchSchema = dispatchPreviewSchema.extend({
  title: z.string().trim().max(200).optional(),
  scheduled_for: z.string().datetime({ offset: true }).nullable().default(null),
});
export const updateDispatchSchema = z.object({
  title: z.string().trim().max(200).optional(),
  parameters: z.record(z.string()).optional(),
  recipients_filter: recipientFilterSchema.optional(),
  scheduled_for: z.string().datetime({ offset: true }).optional(),
});
export const resendSchema = z.object({ phone: z.string().trim().optional() });

// --- Attendance (FR-ATT, §8.4) -------------------------------------------------
export const recordAnomaliesSchema = z
  .object({
    type: z.enum(ANOMALY_TYPES),
    date: day,
    subject_id: uuid.nullable().default(null),
    time_slot: z.string().trim().nullable().default(null),
    arrival_time: time.nullable().default(null),
    student_ids: z.array(uuid).min(1, 'Sélectionnez au moins un élève'),
    note: z.string().trim().nullable().default(null),
  })
  .refine((v) => v.type !== 'ABSENCE' || v.subject_id, { message: 'La matière est obligatoire pour une absence', path: ['subject_id'] })
  .refine((v) => v.type !== 'TARDINESS' || v.arrival_time, { message: "L'heure d'arrivée est obligatoire", path: ['arrival_time'] });
export const updateAnomalySchema = z.object({
  date: day.optional(),
  subject_id: uuid.nullable().optional(),
  time_slot: z.string().trim().nullable().optional(),
  arrival_time: time.nullable().optional(),
  note: z.string().trim().nullable().optional(),
});
export const justifyAnomalySchema = z.object({ note: nonEmpty });
export const confirmAlertsSchema = z.object({ alert_ids: z.array(uuid).min(1) });
export const discardAlertsSchema = z.object({ alert_ids: z.array(uuid).min(1), reason: nonEmpty });

// --- Calendar (FR-CAL) -----------------------------------------------------------
export const triggerSchema = z.object({ days_offset: z.number().int().min(-365).max(365), send_time: time });
export const calendarEventSchema = z
  .object({
    title: nonEmpty,
    type: z.enum(EVENT_TYPES),
    start_date: day,
    end_date: day,
    start_time: time.nullable().default(null),
    place: z.string().trim().nullable().default(null),
    description: z.string().trim().nullable().default(null),
    recipient_filter: recipientFilterSchema,
    template_id: uuid.nullable().default(null),
    triggers: z.array(triggerSchema).default([]),
  })
  .refine((v) => v.end_date >= v.start_date, { message: 'La date de fin doit suivre la date de début', path: ['end_date'] });

// --- Fees (FR-FEE) -----------------------------------------------------------------
export const installmentSchema = z.object({
  name: nonEmpty,
  due_date: day,
  default_amount_xaf: z.number().int().min(0),
  class_amounts: z.record(uuid, z.number().int().min(0)).default({}),
});
export const studentFeeOverrideSchema = z.object({
  student_id: uuid,
  installment_id: uuid,
  amount_due_xaf: z.number().int().min(0).nullable(),
});
export const paymentSchema = z.object({
  student_id: uuid,
  installment_id: uuid,
  amount_xaf: z.number().int().positive('Montant positif requis'),
  paid_on: day,
  reference: z.string().trim().nullable().default(null),
});
export const reminderRuleSchema = z.object({
  installment_id: uuid,
  days_offset: z.number().int().min(-365).max(365),
  send_time: time,
  recipient_filter: recipientFilterSchema,
  is_enabled: z.boolean().default(false),
});
export const prepareReminderSchema = z.object({
  installment_id: uuid,
  recipients_filter: recipientFilterSchema,
  scheduled_for: z.string().datetime({ offset: true }).nullable().default(null),
  preview_only: z.boolean().default(false),
});

// --- Templates & settings ------------------------------------------------------------
export const updateTemplateSchema = z.object({
  title: nonEmpty.optional(),
  purpose: z.enum(TEMPLATE_PURPOSES).optional(),
  parameter_map: z.array(z.string()).optional(),
});
export const createTemplateSchema = z.object({
  title: nonEmpty,
  meta_name: z.string().trim().regex(/^[a-z0-9_]+$/, 'Lettres minuscules, chiffres et _ uniquement'),
  meta_category: z.enum(META_CATEGORIES),
  purpose: z.enum(TEMPLATE_PURPOSES),
  body_preview: nonEmpty,
  parameter_map: z.array(z.string()).default([]),
});
export const settingsSchema = z.object({
  school_name: z.string().trim().optional(),
  school_phone: z.string().trim().optional(),
  wa_phone_number_id: z.string().trim().optional(),
  wa_business_account_id: z.string().trim().optional(),
  wa_access_token: z.string().trim().optional(),
  wa_app_secret: z.string().trim().optional(),
  wa_verify_token: z.string().trim().optional(),
  wa_messages_per_second: z.number().int().min(1).max(1000).optional(),
  wa_daily_limit: z.number().int().min(1).optional(),
  price_utility_xaf: z.number().min(0).optional(),
  price_marketing_xaf: z.number().min(0).optional(),
  price_authentication_xaf: z.number().min(0).optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

// --- Promotion (FR-PRO) ------------------------------------------------------------------
export const promotionSchema = z.object({
  next_year: academicYearSchema,
  // current class id → next-year class name to create/use, or null for "Leaving school"
  class_map: z.record(uuid, z.string().trim().nullable()),
  // student id → outcome; students not listed default to PROMOTED
  outcomes: z.record(uuid, z.enum(ENROLMENT_OUTCOMES)).default({}),
});
export type PromotionInput = z.infer<typeof promotionSchema>;
