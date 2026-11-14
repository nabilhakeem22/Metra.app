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
  engagementArtifacts,
  type EngagementArtifactKind,
  type MetraDb,
} from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import {
  artifactRecordingFile,
  assertConceptOptionSlot,
  assertFileIsEngagementUpload,
  requireDesignableEngagement,
} from './artifact-fences';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { isUuid } from '@/lib/uuid';
import { readFields, readOptionalText } from '@/lib/validation/field-rules';
import { MAX_LABEL_CHARS, MAX_NOTE_CHARS } from '@/lib/validation/text';

const KIND_SET = new Set<string>(ENGAGEMENT_ARTIFACT_KINDS);

export interface RecordArtifactInput {
  engagementId: string;
  kind: EngagementArtifactKind;
  fileId?: string | null;
  contentHash?: string | null;
  label?: string | null;
  note?: string | null;
}

interface AttestedArtifact {
  engagementId: string;
  kind: EngagementArtifactKind;
  fileId: string | null;
  contentHash: string | null;
  label: string | null;
  note: string | null;
}

/** Inserts the artifact row, attested by the caller, and audits it; answers its id. */
async function insertAttestedArtifact(
  tx: MetraDb,
  ctx: OrgContext,
  artifact: AttestedArtifact,
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<string> {
  const { engagementId, kind, fileId, contentHash, label, note } = artifact;
  const [row] = await tx
    .insert(engagementArtifacts)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind,
      fileId,
      contentHash,
      label,
      attestedBy: ctx.userId,
      note,
    })
    .returning({ id: engagementArtifacts.id });

  await audit({
    entity: 'design_engagement',
    entityId: engagementId,
    action: 'create',
    before: null,
    after: { artifact_id: row.id, kind },
  });
  return row.id;
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
  // A kind no picker offers, or a file id that is no id: no form can send these.
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    return { ok: false, error: 'malformed' };
  }

  const fileId = input.fileId ?? null;
  if (fileId !== null && !isUuid(fileId)) {
    return { ok: false, error: 'malformed' };
  }
  // An over-long or unprintable field is a REFUSAL, not a truncation: storing
  // the first 200 characters of a label would quietly rename the studio's
  // artifact. Each is said under its own field.
  const text = readFields({
    contentHash: readOptionalText(input.contentHash, MAX_LABEL_CHARS),
    label: readOptionalText(input.label, MAX_LABEL_CHARS),
    note: readOptionalText(input.note, MAX_NOTE_CHARS),
  });
  if (!text.ok) return fieldsFailed(text.errors);
  const { contentHash, label, note } = text.values;

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      await requireDesignableEngagement(tx, input.engagementId);
      // A retried attach of the SAME upload (its first answer lost in transport)
      // is the artifact already recorded, never a second one.
      if (fileId !== null) {
        const recorded = await artifactRecordingFile(tx, input.engagementId, fileId);
        if (recorded) return recorded;
      }
      if (input.kind === 'concept_option') await assertConceptOptionSlot(tx, input.engagementId);
      if (fileId !== null) await assertFileIsEngagementUpload(tx, input.engagementId, fileId);
      const artifact = { engagementId: input.engagementId, kind: input.kind, fileId, contentHash, label, note };
      return insertAttestedArtifact(tx, ctx, artifact, audit);
    },
  );
}
