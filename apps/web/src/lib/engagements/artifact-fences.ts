import 'server-only';
// The fences an artifact record passes, inside its transaction. The two that
// count or look up recorded artifacts take the delivery row LOCKED first, so two
// concurrent records of one delivery take turns.
import { designEngagements, engagementArtifacts, files, type MetraDb } from '@metra/db';
import { and, count, eq } from 'drizzle-orm';
import { fail, requireInOrg } from '@/lib/actions/mutate';
import { CONCEPT_OPTION_MAX } from './concept-options';
import { takesDesignFiles } from './states';

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

/** The engagement resolves in this org and still takes design files, or the record is refused. */
export async function requireDesignableEngagement(tx: MetraDb, engagementId: string): Promise<void> {
  const engagement = await requireInOrg(
    tx,
    designEngagements,
    engagementId,
    { id: designEngagements.id, state: designEngagements.state },
    'engagement_not_found',
  );
  // No recording an artifact against a finished engagement (abandoned / closed).
  if (!takesDesignFiles(engagement.state)) fail('engagement_not_active');
}

/** The file is this engagement's own upload, or the record is refused. */
export async function assertFileIsEngagementUpload(
  tx: MetraDb,
  engagementId: string,
  fileId: string,
): Promise<void> {
  // A supplied file must be THIS engagement's own upload. RLS scopes the read to
  // the caller's org, so a foreign file simply does not resolve; the entity /
  // entity_id predicates additionally stop an unrelated in-org file (a client
  // logo, a proposal attachment) being smuggled onto an artifact. Mirrors
  // attachDeliverableCore — same three predicates, same `invalid` code.
  const [owned] = await tx
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.entity, 'engagement'),
        eq(files.entityId, engagementId),
      ),
    )
    .limit(1);
  if (!owned) fail('record_not_found');
}
