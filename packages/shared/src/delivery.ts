import type { MessageStatus } from './enums';

// Forward-only status machine (SRS §4.3, §6.3).
const RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  RETRY_PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 1,
};

/**
 * True when a webhook/status update may move a message from `current` to `next`.
 * - Sent → Delivered → Read only move forward; a late "sent" never overwrites "read".
 * - FAILED is terminal, and cannot replace DELIVERED or READ.
 */
export function canTransition(current: MessageStatus, next: MessageStatus): boolean {
  if (current === next) return false;
  if (current === 'FAILED') return false;
  if (next === 'FAILED') return current !== 'DELIVERED' && current !== 'READ';
  // A temporary failure reported after "sent" puts the message back in the retry queue.
  if (next === 'RETRY_PENDING') return current === 'QUEUED' || current === 'SENT';
  if (next === 'QUEUED') return current === 'RETRY_PENDING';
  return RANK[next] > RANK[current];
}

/** Retry delays after attempt 1, 2 and 3 (FR-DLV-002). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
export const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length;

export type ErrorKind = 'TEMPORARY' | 'PERMANENT';

// Meta error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const TEMPORARY_CODES = new Set([
  1, // API unknown
  2, // API service temporarily unavailable
  4, // API too many calls
  80007, // rate limit
  130429, // throughput rate limit
  131000, // something went wrong
  131016, // service unavailable
  131048, // spam rate limit
  131056, // pair rate limit
  133004, // server temporarily unavailable
]);

/** Classifies a Meta error code as retryable or not (FR-DLV-002/003). Unknown codes are permanent. */
export function classifyMetaError(code: number | string | null | undefined): ErrorKind {
  if (code === null || code === undefined || code === 'TIMEOUT' || code === 'NETWORK') return 'TEMPORARY';
  const n = typeof code === 'string' ? Number(code) : code;
  if (Number.isNaN(n)) return 'PERMANENT';
  return TEMPORARY_CODES.has(n) ? 'TEMPORARY' : 'PERMANENT';
}

/** French reason shown to the Administrator for a failed message. */
export function describeMetaError(code: number | string | null | undefined, fallback?: string | null): string {
  const n = Number(code);
  switch (n) {
    case 131026:
      return "Numéro absent de WhatsApp";
    case 100:
    case 131009:
    case 131008:
      return 'Numéro ou paramètre invalide';
    case 132000:
    case 132001:
    case 132005:
    case 132007:
    case 132012:
    case 132015:
    case 132016:
      return 'Modèle refusé ou en pause';
    case 130429:
    case 80007:
    case 131048:
    case 131056:
      return 'Limite de débit atteinte';
    case 131047:
      return 'Fenêtre de 24 h expirée';
    case 131050:
      return "Le destinataire a bloqué les messages de l'école";
    default:
      if (code === 'TIMEOUT' || code === 'NETWORK') return 'Erreur réseau';
      return fallback || `Erreur ${code ?? 'inconnue'}`;
  }
}
