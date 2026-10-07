// The provenance columns of a staff approval row (Design-Engagement Machine):
// none for the studio's own Advance; the channel, the date and the note for an
// approval the client gave the studio directly ("Client approved offline"); and,
// for a concept approval, which option they chose and its LETTER.
//
// THE LETTER IS SAVED, never recomputed (0057), and only a RELEASED option has
// one (owner decision Q1, Oct 8): the studio may record "option B" only for an
// option the client can see lettered on the portal. The position is read from
// the same rule the portal uses (app_concept_option_positions), inside the
// executor's transaction, so the saved letter is the one the client sees.
import type { MetraDb } from '@metra/db';
import { fail } from '@/lib/actions/result';
import type { OfflineApproval } from './offline-approval';
import { conceptOptionPositions } from './queries/concept-positions';

function channelProvenance(offline: OfflineApproval) {
  return { evidence: offline.channel, occurredOn: offline.occurredOn, note: offline.note };
}

/** A design approval: no option to name, so one that names an option is refused. */
export function designApprovalProvenance(offline: OfflineApproval | null) {
  if (offline === null) return {};
  if (offline.chosenArtifactId !== null) fail('invalid');
  return channelProvenance(offline);
}

/**
 * A concept approval, with the chosen option and its saved letter when the
 * studio recorded one. An option with no letter right now (hidden, file-less,
 * past the fourth, a render, another delivery's) is `concept_option_not_found`,
 * which rolls the whole transition back.
 */
export async function conceptApprovalProvenance(
  tx: MetraDb,
  engagementId: string,
  offline: OfflineApproval | null,
) {
  if (offline === null) return {};
  const chosenArtifactId = offline.chosenArtifactId;
  if (chosenArtifactId === null) return channelProvenance(offline);
  const chosenPosition = (await conceptOptionPositions(tx, engagementId)).get(chosenArtifactId);
  if (chosenPosition === undefined) fail('concept_option_not_found');
  return { ...channelProvenance(offline), chosenArtifactId, chosenPosition };
}
