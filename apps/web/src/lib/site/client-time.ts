// The device clock checks of the site diary (Stage 3 site app, plan C2). PURE
// and CLIENT-SAFE. A check-in and a photo carry the time the PHONE says they
// happened, because they may reach the server hours later from the outbox. The
// server keeps that time, but refuses one the phone's clock cannot have got
// right, and marks an upload that arrived long after its visit.
//
// The device time comes as the phone wrote it, a strict ISO instant (see
// parseIsoInstant); the server's own clock comes as a Date.
import type { FieldCode } from '@/lib/actions/field-codes';
import { parseIsoInstant } from './iso-instant';

/** How far ahead of the server a device time may be: ordinary clock drift. */
export const DEVICE_CLOCK_LEAD_ALLOWED_MS = 5 * 60 * 1000;
/** The oldest device time the diary accepts. */
export const DEVICE_TIME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A visit received this long after its check-in shows the studio it came in late. */
export const LATE_UPLOAD_AFTER_MS = 2 * 60 * 60 * 1000;

export type DeviceTimeProblem = Extract<FieldCode, 'in_future' | 'too_old'>;

function serverTimeOf(instant: Date): number {
  const time = instant.getTime();
  if (Number.isNaN(time)) throw new RangeError('A device clock check needs a valid server instant.');
  return time;
}

/** What is wrong with a device time against the server's now, or null when it may be recorded. */
export function deviceTimeProblem(deviceTimeIso: string, serverNow: Date): DeviceTimeProblem | null {
  const ageMs = serverTimeOf(serverNow) - parseIsoInstant(deviceTimeIso).getTime();
  if (ageMs < -DEVICE_CLOCK_LEAD_ALLOWED_MS) return 'in_future';
  if (ageMs > DEVICE_TIME_MAX_AGE_MS) return 'too_old';
  return null;
}

/** Whether a visit reached the server more than two hours after its check-in. */
export function isLateUpload(checkedInAtIso: string, receivedAt: Date): boolean {
  return serverTimeOf(receivedAt) - parseIsoInstant(checkedInAtIso).getTime() > LATE_UPLOAD_AFTER_MS;
}
