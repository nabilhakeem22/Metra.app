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
import { isValidOccurredOn } from './event-provenance';

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

/**
 * The offline approval a transition payload carries, or null when it is
 * invalid: not an object, an unknown channel, a note over MAX_NOTE_CHARS, an
 * `occurredOn` that is not a real day on or before `todayIso`, or a
 * `chosenArtifactId` that is present but not a uuid.
 */
export function parseOfflineApproval(payload: unknown, todayIso: string): OfflineApproval | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const input = payload as Record<string, unknown>;
  if (!isOfflineApprovalChannel(input.channel)) return null;

  const rawNote = textOrAbsent(input.note);
  const rawOccurredOn = textOrAbsent(input.occurredOn);
  const rawChosen = textOrAbsent(input.chosenArtifactId);
  if (rawNote === false || rawOccurredOn === false || rawChosen === false) return null;

  const note = optionalText(rawNote, MAX_NOTE_CHARS);
  const occurredOn = optionalText(rawOccurredOn, MAX_LABEL_CHARS);
  const chosenArtifactId = optionalText(rawChosen, MAX_LABEL_CHARS);
  if (note === TOO_LONG || occurredOn === TOO_LONG || chosenArtifactId === TOO_LONG) return null;
  if (occurredOn !== null && !isValidOccurredOn(occurredOn, todayIso)) return null;
  if (chosenArtifactId !== null && !isUuid(chosenArtifactId)) return null;

  return { channel: input.channel, occurredOn, note, chosenArtifactId };
}
