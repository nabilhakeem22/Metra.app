// Design-Engagement Machine, Step 5 — recording engagement artifacts. An
// artifact is a metadata record of a spatial/design deliverable attested by a
// staff member (a measured `survey`, a developer `autocad` set, and later
// concept options / renders / shop drawings / BOQs). In this simple model,
// RECORDING an artifact IS attesting it: `attested_by` = the caller,
// `attested_at` = now(). The engagement is verified in-org (RLS scopes the read)
// and NOT terminal before the insert.
//
// `engagement_artifacts.file_id` carries NO foreign key (the upload flow landed
// after this table), so a supplied `fileId` is verified here the same way
// attachDeliverableCore verifies it: the `files` row must resolve in-org AND be
// stamped entity='engagement' with entity_id = this engagement. Without that check
// an in-org actor could point an artifact at ANOTHER tenant's file, and the only
// thing standing between that and a client portal would be a single join
// predicate in the token SDF.
import {
  ENGAGEMENT_ARTIFACT_KINDS,
  designEngagements,
  engagementArtifacts,
  files,
  type EngagementArtifactKind,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

const KIND_SET = new Set<string>(ENGAGEMENT_ARTIFACT_KINDS);

/** Canonical uuid shape — a malformed `fileId` is `invalid`, not a cast error. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordArtifactInput {
  engagementId: string;
  kind: EngagementArtifactKind;
  fileId?: string | null;
  contentHash?: string | null;
  label?: string | null;
  note?: string | null;
}

/** Trim a nullable free-text field to a stored value ('' / whitespace -> null). */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Record (and thereby attest) one artifact against an engagement. Gated on the
 * `engagements_design` capability (create). Flow: validate the artifact `kind`
 * (else `invalid`); open the RLS tx; assert the engagement resolves in-org
 * (`engagement_not_found` if absent/foreign) and is NOT terminal (else
 * `engagement_not_active`); verify any supplied `fileId` is this engagement's own
 * in-org upload (else `invalid`); insert one `engagement_artifacts` row with
 * `attested_by = ctx.userId` and `attested_at = now()`. Returns the new artifact
 * id. Never throws to the client — coded ActionResult only.
 */
export async function recordArtifactCore(
  ctx: OrgContext,
  input: RecordArtifactInput,
): Promise<ActionResult & { data?: string }> {
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    return { ok: false, error: 'invalid' };
  }

  const fileId = input.fileId ?? null;
  if (fileId !== null && !UUID_RE.test(fileId)) {
    return { ok: false, error: 'invalid' };
  }
  const contentHash = optionalText(input.contentHash);
  const label = optionalText(input.label);
  const note = optionalText(input.note);

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      // No recording an artifact against a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      // A supplied file must be THIS engagement's own upload. RLS scopes the read to
      // the caller's org, so a foreign file simply does not resolve; the entity /
      // entity_id predicates additionally stop an unrelated in-org file (a client
      // logo, a proposal attachment) being smuggled onto an artifact. Mirrors
      // attachDeliverableCore — same three predicates, same `invalid` code.
      if (fileId !== null) {
        const [owned] = await tx
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.id, fileId),
              eq(files.entity, 'engagement'),
              eq(files.entityId, input.engagementId),
            ),
          )
          .limit(1);
        if (!owned) fail('invalid');
      }

      const [row] = await tx
        .insert(engagementArtifacts)
        .values({
          orgId: ctx.orgId,
          engagementId: input.engagementId,
          kind: input.kind,
          fileId,
          contentHash,
          label,
          attestedBy: ctx.userId,
          note,
        })
        .returning({ id: engagementArtifacts.id });

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'create',
        before: null,
        after: { artifact_id: row.id, kind: input.kind },
      });
      return row.id;
    },
  );
}
