// French labels for enum values shown in the interface (NFR-03).

export const DISPATCH_STATUS: Record<string, string> = {
  AWAITING_CONFIRMATION: 'À confirmer',
  SCHEDULED: 'Programmé',
  PROCESSING: 'En cours',
  COMPLETED: 'Terminé',
  COMPLETED_WITH_FAILURES: 'Terminé avec échecs',
  CANCELLED: 'Annulé',
};

export const MESSAGE_STATUS: Record<string, string> = {
  QUEUED: 'En file',
  SENT: 'Envoyé',
  DELIVERED: 'Distribué',
  READ: 'Lu',
  RETRY_PENDING: 'Nouvel essai prévu',
  FAILED: 'Échec',
};

export const SOURCE: Record<string, string> = {
  MANUAL: 'Manuel',
  ATTENDANCE: 'Absences',
  CALENDAR: 'Calendrier',
  FEE_RULE: 'Règle de frais',
};

export const PURPOSE: Record<string, string> = {
  TARDINESS: 'Retard',
  ABSENCE: 'Absence',
  PAYMENT: 'Frais',
  CALENDAR: 'Calendrier',
  GENERAL: 'Annonce',
};

export const META_STATUS: Record<string, string> = {
  APPROVED: 'Approuvé',
  PENDING: 'En attente',
  REJECTED: 'Rejeté',
  PAUSED: 'En pause',
  DISABLED: 'Désactivé',
};

export const META_CATEGORY: Record<string, string> = {
  UTILITY: 'Utilitaire',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Authentification',
};

export const EVENT_TYPE: Record<string, string> = {
  HOLIDAY: 'Congé',
  MEETING: 'Réunion',
  EXAM: 'Examen',
  EVENT: 'Événement',
};

export const ANOMALY: Record<string, string> = { ABSENCE: 'Absence', TARDINESS: 'Retard' };

export const OUTCOME: Record<string, string> = { PROMOTED: 'Admis', REPEATING: 'Redouble', LEFT: 'Quitte l’école' };

export const STUDENT_STATUS: Record<string, string> = { ACTIVE: 'Actif', LEFT: 'Parti', ARCHIVED: 'Archivé' };

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
