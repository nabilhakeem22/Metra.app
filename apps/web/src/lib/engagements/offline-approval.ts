// "Client approved offline": the studio records, on the client's behalf, an
// approval they gave by phone, on WhatsApp, in person or by email. PURE and
// CLIENT-SAFE: the executor's side-effect parses the transition payload with it,
// and the form offers exactly these channels.
import { isUuid } from '@/lib/uuid';
import { MAX_LABEL_CHARS, TOO_LONG, optionalText } from '@/lib/validation/text';
import type { FieldErrors } from '@/lib/actions/field-errors';
import type { ActionCode } from '@/lib/actions/result';
import type { MemberRole } from '@/lib/permissions/roles';
import {
  readOfflineApprovalFields,
  type OfflineApprovalField,
} from './offline-approval-field-rules';
import type { OfflineApprovalBounds } from './review-round';
import { ENDING_DECIDERS } from './transitions/trigger-roles';

/**
 * Who may record an approval the client gave the studio directly (owner
 * decision, Oct 7): the same people who decide how a delivery ends. A site
 * engineer still advances every other stage; standing in for the client's
 * consent is the owner's, an admin's or the project manager's call.
 */
const OFFLINE_APPROVAL_DECIDERS: readonly MemberRole[] = ENDING_DECIDERS;

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
  | { ok: false; fields: FieldErrors<OfflineApprovalField> }
  | { ok: false; code: ActionCode };

/**
 * The offline approval a transition payload carries, or what refuses it. What
 * the studio typed (no channel chosen, a day outside the round under review or
 * not a real day, a note over MAX_NOTE_CHARS) comes back as `fields`, under the
 * box to change. The shape no form can send (not an object, an unknown channel,
 * a non-string field, a `chosenArtifactId` that is not a uuid) is `malformed`.
 */
export function parseOfflineApproval(
  payload: unknown,
  bounds: OfflineApprovalBounds,
): ParsedOfflineApproval {
  const refuse = (code: ActionCode): ParsedOfflineApproval => ({ ok: false, code });
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return refuse('malformed');
  }
  const input = payload as Record<string, unknown>;
  const rawNote = textOrAbsent(input.note);
  const rawOccurredOn = textOrAbsent(input.occurredOn);
  const rawChosen = textOrAbsent(input.chosenArtifactId);
  if (rawNote === false || rawOccurredOn === false || rawChosen === false) return refuse('malformed');

  const typed = readOfflineApprovalFields(
    { channel: input.channel, occurredOn: rawOccurredOn, note: rawNote },
    bounds,
  );
  if (!typed.ok) return { ok: false, fields: typed.errors };
  if (!isOfflineApprovalChannel(input.channel)) return refuse('malformed');
  const chosenArtifactId = optionalText(rawChosen, MAX_LABEL_CHARS);
  if (chosenArtifactId === TOO_LONG || (chosenArtifactId !== null && !isUuid(chosenArtifactId))) {
    return refuse('malformed');
  }

  const { occurredOn, note } = typed.values;
  return { ok: true, approval: { channel: input.channel, occurredOn, note, chosenArtifactId } };
}
