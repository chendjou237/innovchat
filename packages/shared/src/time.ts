import { fr } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** All schedules and calendar triggers use the school's time zone (SRS §2.3). */
export const SCHOOL_TZ = 'Africa/Douala';

/**
 * "2026-11-14" → 2026-11-14T00:00:00Z. Calendar days are carried as UTC midnight, which is
 * what Postgres DATE columns store and return, whatever the machine's time zone.
 */
export function parseDay(day: string): Date {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Date invalide : ${day}`);
  return d;
}

/** Adds days to a "yyyy-MM-dd" day. */
export function addDaysToDay(day: string, n: number): string {
  return new Date(parseDay(day).getTime() + n * 86400000).toISOString().slice(0, 10);
}

/**
 * Date → "2026-11-14": the calendar day in the school time zone. Also correct for DATE
 * values (UTC midnight), since Africa/Douala is UTC+1 all year.
 */
export function toDay(d: Date): string {
  return formatInTimeZone(d, SCHOOL_TZ, 'yyyy-MM-dd');
}

/**
 * Send instant of a trigger: `days_offset` days from `day` at `HH:mm`, school time.
 * Negative offsets are before the day (FR-CAL-003, FR-FEE-007).
 */
export function triggerInstant(day: string, daysOffset: number, sendTime: string): Date {
  return fromZonedTime(`${addDaysToDay(day, daysOffset)}T${normalizeTime(sendTime)}:00`, SCHOOL_TZ);
}

export function normalizeTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) throw new Error(`Heure invalide : ${t}`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** "2026-11-14" → "14/11/2026". */
export function formatDayFr(day: string | Date): string {
  const s = typeof day === 'string' ? day.slice(0, 10) : day.toISOString().slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** "2026-11-14" → "samedi 14 novembre 2026". */
export function formatDayLongFr(day: string | Date): string {
  const d = typeof day === 'string' ? parseDay(day) : parseDay(day.toISOString());
  return formatInTimeZone(d, 'UTC', 'EEEE d MMMM yyyy', { locale: fr });
}

/** Instant → "05/10/2026 08:00" in school time. */
export function formatInstantFr(d: Date | string): string {
  return formatInTimeZone(typeof d === 'string' ? new Date(d) : d, SCHOOL_TZ, 'dd/MM/yyyy HH:mm');
}

/** "08:00" → "08h00". */
export function formatTimeFr(t: string): string {
  return normalizeTime(t).replace(':', 'h');
}

/** 150000 → "150 000" (FCFA amounts). */
export function formatXaf(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/ | /g, ' ');
}
