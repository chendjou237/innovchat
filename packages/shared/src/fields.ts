// System fields a template parameter can be mapped to (FR-TPL-003).
// A template's parameter_map is an ordered list: parameter_map[0] fills {{1}}, etc.
// Keys starting with "param:" are read from the dispatch's shared parameters.

export const TEMPLATE_FIELDS = {
  parent_name: 'Nom du parent',
  student_full_name: "Nom complet de l'élève",
  student_first_name: "Prénom de l'élève",
  class_name: 'Classe',
  date: "Date de l'anomalie",
  subject: 'Matière',
  time_slot: 'Créneau horaire',
  arrival_time: "Heure d'arrivée",
  installment_name: 'Tranche',
  balance_due: 'Solde dû (FCFA)',
  due_date: "Date d'échéance",
  event_title: "Titre de l'événement",
  event_date: "Date de l'événement",
  event_time: "Heure de l'événement",
  event_place: "Lieu de l'événement",
  event_description: "Description de l'événement",
  school_name: "Nom de l'école",
  school_phone: "Téléphone de l'école",
  'param:message': 'Message libre',
} as const;

export type TemplateFieldKey = keyof typeof TEMPLATE_FIELDS | `param:${string}`;

export function fieldLabel(key: string): string {
  if (key in TEMPLATE_FIELDS) return TEMPLATE_FIELDS[key as keyof typeof TEMPLATE_FIELDS];
  if (key.startsWith('param:')) return `Paramètre « ${key.slice(6)} »`;
  return key;
}

/** Shared-parameter names a template needs from the person sending it. */
export function sharedParamNames(parameterMap: string[]): string[] {
  return parameterMap.filter((k) => k.startsWith('param:')).map((k) => k.slice(6));
}

// Cameroonian secondary-school order: 6e, 5e, 4e, 3e, 2nde, 1ère, Tle.
const LEVEL_ORDER = ['6', '5', '4', '3', '2', '1', 't'];

/** Sorts classes in school order (6e A … Tle C) rather than alphabetically. */
export function compareClasses(a: { name: string; level?: string }, b: { name: string; level?: string }): number {
  const rank = (c: { name: string; level?: string }) => {
    const k = (c.level || c.name).trim().toLowerCase().charAt(0);
    const i = LEVEL_ORDER.indexOf(k);
    return i === -1 ? LEVEL_ORDER.length : i;
  };
  return rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr');
}
