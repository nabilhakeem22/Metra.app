import 'server-only';
// The ARTIFACT half of issuing a BOQ: record its PDF in the delivery and make it
// the only BOQ any delivery of the project shows. Runs inside the transaction
// `freeze.ts#freezeAndRecordIssue` opens, after the BOQ row is frozen.
import { designEngagements, engagementArtifacts, type MetraDb } from '@metra/db';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import type { OrgContext } from '@/lib/db/context';
import type { FreezeIssueInput } from './freeze';

/** The engagement's `boq` artifact for this PDF, shown to the client. */
export async function recordArtifact(
  tx: MetraDb,
  ctx: OrgContext,
  input: FreezeIssueInput,
): Promise<string> {
  const [artifact] = await tx
    .insert(engagementArtifacts)
    .values({
      orgId: ctx.orgId,
      engagementId: input.engagementId,
      kind: 'boq',
      fileId: input.fileId,
      label: input.label,
      attestedBy: ctx.userId,
      clientVisible: true,
    })
    .returning({ id: engagementArtifacts.id });
  if (!artifact) fail('generic');
  return artifact.id;
}

/**
 * Only the newest BOQ is in ANY delivery link of the project: every OTHER
 * visible `boq` artifact (an earlier version, or a BOQ file shared by hand), on
 * this engagement or any other engagement of the same project, is hidden, with
 * `updated_at` stamped as the portal's "shared on" date. Project-wide because
 * the supersede is: a superseded BOQ left visible in a sibling delivery would
 * still be downloadable there. Other kinds are untouched.
 */
export async function publishOnlyLatest(
  tx: MetraDb,
  input: FreezeIssueInput,
  artifactId: string,
): Promise<void> {
  const projectEngagements = tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(eq(designEngagements.projectId, input.projectId));
  await tx
    .update(engagementArtifacts)
    .set({ clientVisible: false, updatedAt: new Date() })
    .where(
      and(
        or(
          eq(engagementArtifacts.engagementId, input.engagementId),
          inArray(engagementArtifacts.engagementId, projectEngagements),
        ),
        eq(engagementArtifacts.kind, 'boq'),
        eq(engagementArtifacts.clientVisible, true),
        ne(engagementArtifacts.id, artifactId),
      ),
    );
}
