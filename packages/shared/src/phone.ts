// Phone normalisation to E.164 (FR-STU-003).

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises a phone number typed by a person or found in an import file.
 * - A 9-digit Cameroonian number starting with 6 becomes +237XXXXXXXXX.
 * - 237XXXXXXXXX and 00237XXXXXXXXX are accepted.
 * - Any other number must already be in international form (+ or 00 prefix).
 * Returns null when the number cannot be normalised.
 */
export function normalizePhone(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s.\-()/]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);

  if (/^6\d{8}$/.test(s)) return '+237' + s;
  if (/^2376\d{8}$/.test(s)) return '+' + s;
  if (s.startsWith('+237')) return /^\+2376\d{8}$/.test(s) ? s : null;
  if (s.startsWith('+')) return E164.test(s) ? s : null;
  return null;
}

/** "+237671234567" → "+237 6•• ••• 567" (§9.1: masked parent number). */
export function maskPhone(e164: string): string {
  if (e164.startsWith('+237') && e164.length === 13) {
    return `+237 ${e164[4]}•• ••• ${e164.slice(-3)}`;
  }
  if (e164.length <= 5) return e164;
  return e164.slice(0, 4) + ' ••• ' + e164.slice(-3);
}
