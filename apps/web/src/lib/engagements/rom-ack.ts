/**
 * Does a client's ROM acknowledgement answer the issuance that is live now?
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`. It has to be, because the
 * same question is asked in two places that must never disagree — the
 * `romAcknowledged` transition guard on the server, and the "awaiting
 * acknowledgement" badge in the cockpit. A badge that says the client has agreed
 * while the guard refuses to advance is a studio staring at a button that will
 * not work, with the UI insisting everything is fine.
 */

/** The two fields the question needs. Structural, so both the database row and
 *  the serialised timeline record satisfy it without either importing the other. */
export interface AcknowledgementEvent {
  kind: string;
  acknowledgedIssueAt: Date | null;
}

/**
 * True only when `event` is an acknowledgement of THIS issuance.
 *
 * FALSE WHEN EITHER SIDE IS NULL, and that is the whole design:
 *  - no `romIssuedAt` means nothing has been sent to the client, so there is
 *    nothing an acknowledgement could be answering;
 *  - no `acknowledgedIssueAt` (null, or absent on a partially-built record) means
 *    the row predates 0049 and we do not know
 *    which figures the client saw. Treating "unknown" as "yes" would let an
 *    engagement advance on evidence nobody can read, so it reads as "no" and the
 *    portal simply asks again. Deliberately the same rule as the SDFs' `is not
 *    distinct from`, which also refuses to match a NULL to a real instant.
 */
export function acknowledgesIssuance(
  event: AcknowledgementEvent,
  romIssuedAt: Date | null,
): boolean {
  if (!romIssuedAt || !event.acknowledgedIssueAt) return false;
  if (event.kind !== 'rom_acknowledgement') return false;
  return event.acknowledgedIssueAt.getTime() === romIssuedAt.getTime();
}
