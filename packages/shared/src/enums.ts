// String unions mirroring the Prisma enums (SRS §4.1, §4.2). Kept here so the web app
// can use them without depending on the Prisma client.

export const STUDENT_STATUSES = ['ACTIVE', 'LEFT', 'ARCHIVED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const ENROLMENT_OUTCOMES = ['PROMOTED', 'REPEATING', 'LEFT'] as const;
export type EnrolmentOutcome = (typeof ENROLMENT_OUTCOMES)[number];

export const ANOMALY_TYPES = ['ABSENCE', 'TARDINESS'] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const EVENT_TYPES = ['HOLIDAY', 'MEETING', 'EXAM', 'EVENT'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const TEMPLATE_PURPOSES = ['TARDINESS', 'ABSENCE', 'PAYMENT', 'CALENDAR', 'GENERAL'] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

export const META_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'] as const;
export type MetaCategory = (typeof META_CATEGORIES)[number];

export const META_STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'] as const;
export type MetaStatus = (typeof META_STATUSES)[number];

export const DISPATCH_SOURCES = ['MANUAL', 'ATTENDANCE', 'CALENDAR', 'FEE_RULE'] as const;
export type DispatchSource = (typeof DISPATCH_SOURCES)[number];

export const DISPATCH_STATUSES = [
  'AWAITING_CONFIRMATION',
  'SCHEDULED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_FAILURES',
  'CANCELLED',
] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const MESSAGE_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'RETRY_PENDING', 'FAILED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'DISPATCH_FAILURES',
  'AWAITING_CONFIRMATION',
  'TEMPLATE_REJECTED',
  'IMPORT_DONE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const IMPORT_KINDS = ['STUDENTS', 'PAYMENTS'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_STATUSES = ['PREVIEW', 'COMMITTED', 'CANCELLED'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
