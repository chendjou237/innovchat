import { describe, expect, it } from 'vitest';
import { canTransition, classifyMetaError } from './delivery';
import { maskPhone, normalizePhone } from './phone';
import { formatXaf, triggerInstant } from './time';

describe('normalizePhone', () => {
  it.each([
    ['671234567', '+237671234567'],
    ['6 71 23 45 67', '+237671234567'],
    ['237671234567', '+237671234567'],
    ['00237671234567', '+237671234567'],
    ['+237 671-23-45-67', '+237671234567'],
    ['+33612345678', '+33612345678'],
    [671234567, '+237671234567'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['', '12345', '771234567', '+23767123456', '+2376712345678', 'abc', null])('rejects %s', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );

  it('masks numbers', () => expect(maskPhone('+237671234567')).toBe('+237 6•• ••• 567'));
});

describe('status machine', () => {
  it('only moves forward', () => {
    expect(canTransition('QUEUED', 'SENT')).toBe(true);
    expect(canTransition('SENT', 'READ')).toBe(true);
    expect(canTransition('READ', 'SENT')).toBe(false);
    expect(canTransition('READ', 'DELIVERED')).toBe(false);
    expect(canTransition('DELIVERED', 'DELIVERED')).toBe(false);
  });
  it('treats FAILED as terminal and never after delivery', () => {
    expect(canTransition('SENT', 'FAILED')).toBe(true);
    expect(canTransition('DELIVERED', 'FAILED')).toBe(false);
    expect(canTransition('FAILED', 'SENT')).toBe(false);
  });
});

describe('classifyMetaError', () => {
  it('retries rate limits and server errors', () => {
    expect(classifyMetaError(130429)).toBe('TEMPORARY');
    expect(classifyMetaError('131000')).toBe('TEMPORARY');
    expect(classifyMetaError('TIMEOUT')).toBe('TEMPORARY');
  });
  it('does not retry invalid numbers or template issues', () => {
    expect(classifyMetaError(131026)).toBe('PERMANENT');
    expect(classifyMetaError(100)).toBe('PERMANENT');
    expect(classifyMetaError(132001)).toBe('PERMANENT');
  });
});

describe('triggerInstant (Africa/Douala, UTC+1)', () => {
  it('7 days before at 08:00', () =>
    expect(triggerInstant('2026-11-14', -7, '08:00').toISOString()).toBe('2026-11-07T07:00:00.000Z'));
  it('same day at 07:00', () =>
    expect(triggerInstant('2026-11-14', 0, '7:00').toISOString()).toBe('2026-11-14T06:00:00.000Z'));
  it('3 days after', () =>
    expect(triggerInstant('2026-12-30', 3, '08:30').toISOString()).toBe('2027-01-02T07:30:00.000Z'));
});

it('formats FCFA', () => expect(formatXaf(150000)).toBe('150 000'));

it('keeps calendar days in UTC whatever the machine time zone', async () => {
  const { parseDay, toDay, formatDayLongFr } = await import('./time');
  expect(parseDay('2026-10-05').toISOString()).toBe('2026-10-05T00:00:00.000Z');
  expect(toDay(parseDay('2026-10-05'))).toBe('2026-10-05');
  expect(formatDayLongFr('2026-11-14')).toBe('samedi 14 novembre 2026');
});
