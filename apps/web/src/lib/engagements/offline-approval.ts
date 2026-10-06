// "Client approved offline": the studio records, on the client's behalf, an
// approval they gave by phone, on WhatsApp, in person or by email. PURE and
// CLIENT-SAFE: the executor's side-effect parses the transition payload with it,
// and the form offers exactly these channels.
import { isUuid } from '@/lib/uuid';
import {
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  TOO_LONG,
  optionalText,
} from '@/lib/validation/text';
import type { ActionCode } from '@/lib/actions/result';
import type { MemberRole } from '@/lib/permissions/roles';
import { isCalendarDay } from './event-provenance';
import type { OfflineApprovalBounds } from './review-round';
import { ENDING_DECIDERS } from './transitions/trigger-roles';

/**
 * Who may record an approval the client gave the studio directly (owner
 * decision, Oct 7): the same people who decide how a delivery ends. A site
 * engineer still advances every other stage; standing in for the client's
 * consent is the owner's, an admin's or the project manager's call.
 */
export const OFFLINE_APPROVAL_DECIDERS: readonly MemberRole[] = ENDING_DECIDERS;

export function mayRecordOfflineApproval(role: MemberRole): boolean {
  return OFFLINE_APPROVAL_DECIDERS.includes(role);
}

/** How the client gave the approval. Stored in `engagement_events.evidence`. */
export const OFFLINE_APPROVAL_CHANNELS = ['phone', 'whatsapp', 'in_person', 'email', 'other'] as const;
export type OfflineApprovalChannel = (typeof OFFLINE_APPROVAL_CHANNELS)[number];

export interface OfflineApproval {
  channel: OfflineApprovalChannel;
  /** The day the client actually approved (`YYYY-MM-DD`), when not today. */
  occurredOn: string | null;
  note: string | null;
  /** Which concept option they chose (concept_review). */
  chosenArtifactId: string | null;
}

export function isOfflineApprovalChannel(value: unknown): value is OfflineApprovalChannel {
  return (OFFLINE_APPROVAL_CHANNELS as readonly unknown[]).includes(value);
}

/**
 * The channel of an approval recorded offline, read off its ledger row: an
 * approval kind whose `evidence` is a channel code. Null for anything else (an
 * acknowledgement's evidence is the studio's own free text).
 */
export function offlineApprovalChannelOf(event: {
  kind: string;
  evidence: string | null;
}): OfflineApprovalChannel | null {
  const approval = event.kind === 'concept_approval' || event.kind === 'design_approval';
  return approval && isOfflineApprovalChannel(event.evidence) ? event.evidence : null;
}

/** A present value that is not a string is refused rather than ignored. */
function textOrAbsent(value: unknown): string | null | undefined | false {
  if (value === undefined || value === null) return value;
  return typeof value === 'string' ? value : false;
}

export type ParsedOfflineApproval =
  | { ok: true; approval: OfflineApproval }
  | { ok: false; code: ActionCode };

/**
 * The offline approval a transition payload carries, or the code that refuses
 * it. `invalid`: not an object, an unknown channel, a non-string field, a date
 * that is not a real `YYYY-MM-DD`, or a `chosenArtifactId` that is not a uuid.
 * `offline_approval_note_too_long`: a note over MAX_NOTE_CHARS.
 * `offline_approval_date_out_of_range`: a real day before the round under
 * review or after today (review-round.ts). The two named codes are the ones a
 * retry can never fix, so the studio is told which field to change.
 */
export function parseOfflineApproval(
  payload: unknown,
  bounds: OfflineApprovalBounds,
): ParsedOfflineApproval {
  const refuse = (code: ActionCode): ParsedOfflineApproval => ({ ok: false, code });
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return refuse('invalid');
  }
  const input = payload as Record<string, unknown>;
  if (!isOfflineApprovalChannel(input.channel)) return refuse('invalid');

  const rawNote = textOrAbsent(input.note);
  const rawOccurredOn = textOrAbsent(input.occurredOn);
  const rawChosen = textOrAbsent(input.chosenArtifactId);
  if (rawNote === false || rawOccurredOn === false || rawChosen === false) return refuse('invalid');

  const note = optionalText(rawNote, MAX_NOTE_CHARS);
  if (note === TOO_LONG) return refuse('offline_approval_note_too_long');
  const occurredOn = optionalText(rawOccurredOn, MAX_LABEL_CHARS);
  if (occurredOn === TOO_LONG || (occurredOn !== null && !isCalendarDay(occurredOn))) {
    return refuse('invalid');
  }
  if (occurredOn !== null && (occurredOn < bounds.earliest || occurredOn > bounds.latest)) {
    return refuse('offline_approval_date_out_of_range');
  }
  const chosenArtifactId = optionalText(rawChosen, MAX_LABEL_CHARS);
  if (chosenArtifactId === TOO_LONG || (chosenArtifactId !== null && !isUuid(chosenArtifactId))) {
    return refuse('invalid');
  }

  return { ok: true, approval: { channel: input.channel, occurredOn, note, chosenArtifactId } };
}
