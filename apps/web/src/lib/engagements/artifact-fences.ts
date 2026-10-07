import 'server-only';
// The fences an artifact record passes, inside its transaction, with the
// delivery row LOCKED so two concurrent records of one delivery take turns.
import { designEngagements, engagementArtifacts, type MetraDb } from '@metra/db';
import { and, count, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { CONCEPT_OPTION_MAX } from './concept-options';

async function lockEngagement(tx: MetraDb, engagementId: string): Promise<void> {
  await tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagementId))
    .for('update');
}

/**
 * The artifact already recording this upload, if any. An attach whose answer was
 * lost (a dropped connection, a Worker cut off) may well have committed; the
 * browser retries it with the same file, and the retry must find that artifact
 * rather than record the same file twice (for a concept option, a permanent
 * second option the client sees, using up one of the four slots).
 */
export async function artifactRecordingFile(
  tx: MetraDb,
  engagementId: string,
  fileId: string,
): Promise<string | null> {
  await lockEngagement(tx, engagementId);
  const [recorded] = await tx
    .select({ id: engagementArtifacts.id })
    .from(engagementArtifacts)
    .where(and(eq(engagementArtifacts.engagementId, engagementId), eq(engagementArtifacts.fileId, fileId)))
    .limit(1);
  return recorded?.id ?? null;
}

/**
 * Concept options are APPEND-ONLY and `optionsReady` accepts at most
 * CONCEPT_OPTION_MAX, so a fifth one strands the delivery for good. The browser
 * stops offering the upload at the cap; this is the fence. The engagement row is
 * locked first so two concurrent uploads cannot both count three and both land.
 */
export async function assertConceptOptionSlot(tx: MetraDb, engagementId: string): Promise<void> {
  await lockEngagement(tx, engagementId);
  const [{ recorded }] = await tx
    .select({ recorded: count() })
    .from(engagementArtifacts)
    .where(
      and(
        eq(engagementArtifacts.engagementId, engagementId),
        eq(engagementArtifacts.kind, 'concept_option'),
      ),
    );
  if (recorded >= CONCEPT_OPTION_MAX) fail('concept_options_out_of_range');
}
