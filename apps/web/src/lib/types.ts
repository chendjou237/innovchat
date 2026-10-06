// Shapes returned by the API (only the fields the interface uses).

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface Year {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  _count?: { classes: number; enrolments: number };
}

export interface Department {
  id: string;
  name: string;
  _count?: { classes: number };
}

export interface SchoolClass {
  id: string;
  name: string;
  level: string;
  departmentId: string;
  department?: Department;
  _count?: { enrolments: number };
}

export interface Subject {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Template {
  id: string;
  title: string;
  metaName: string;
  language: string;
  metaCategory: string;
  purpose: string;
  bodyPreview: string;
  parameterMap: string[];
  metaStatus: string;
  lastSyncedAt: string | null;
}

export interface Preview {
  students: number;
  messages: number;
  students_without_contact: { id: string; name: string; class: string }[];
  estimated_cost_xaf: number;
  sample_message: string;
  template_status: string;
  selected: { id: string; name: string; matricule: string; class: string; phones: string[]; balance?: number }[];
  selected_truncated: boolean;
  daily_limit: { limit: number; remaining_today: number; days_needed: number };
}

export interface Dispatch {
  id: string;
  title: string;
  purpose: string;
  source: string;
  status: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  estimatedCostXaf: number;
  studentsCount: number;
  messagesCount: number;
  cancelReason: string | null;
  recipientFilter: import('@innovcare/shared').RecipientFilter;
  fixedParameters: Record<string, string>;
  templateId: string;
  template?: { title: string; metaCategory: string; bodyPreview?: string };
  counts?: Record<string, number>;
  eventTrigger?: { event: { id: string; title: string } } | null;
  feeRule?: { installment: { id: string; name: string } } | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}
