import 'server-only';
import { designEngagements, files } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import {
  createSignedUploadUrl,
  ensureFilesBucket,
  getSignedUrl,
  type SignedUpload,
} from '@/lib/storage';
import { recordArtifactCore } from './artifacts';
import {
  ALLOWED_EXTENSIONS,
  CATEGORY_WRITE_KIND,
  validateDeliverableFile,
} from './deliverable-files';
import { isTerminal } from './states';
import type { WorkingFileCategory } from './working-files';
import { isUuid } from '@/lib/uuid';

// Deliverable Uploads — the DB/Storage cores behind the three delivery-tray
// upload actions. Each is a self-contained `*Core(ctx, input) -> ActionResult`
// (API-ready), gated on the §2.2 `engagements_design` cell and in-org verified;
// the thin `'use server'` wrappers in ./actions.ts add `requireOrg()` +
// `revalidatePath`. Reuses lib/storage.ts (signed PUT + signed GET, object key
// server-minted as `{org_id}/engagement/{uuid}`) and recordArtifactCore (the
// attest-on-record artifact writer) — no parallel file plumbing.

/** A working-file category only if it is one of the known upload categories. */
function isWorkingFileCategory(value: string): value is WorkingFileCategory {
  return Object.prototype.hasOwnProperty.call(ALLOWED_EXTENSIONS, value);
}

export interface CreateDeliverableUploadInput {
  engagementId: string;
  category: WorkingFileCategory;
  originalName?: string;
  contentType?: string;
  sizeBytes?: number;
}

/**
 * Mint a signed upload URL for a delivery deliverable. Gated on
 * `engagements_design` (create). Order: capability → UUID shape → the engagement
 * resolves in-org (RLS-scoped; `engagement_not_found` if absent/foreign) AND is
 * NOT terminal (`engagement_not_active`) → extension/size validation
 * (`invalid` / `file_too_large`) BEFORE any Storage write → bucket ensured →
 * a `files` row (entity='engagement', entity_id=engagementId) + a signed PUT
 * URL. The object key is derived server-side from the caller's org — client input
 * never reaches the path.
 */
export async function createDeliverableUploadCore(
  ctx: OrgContext,
  input: CreateDeliverableUploadInput,
): Promise<SignedUpload | ActionResult> {
  if (!can(ctx.role, 'engagements_design', 'create')) return err('forbidden');
  if (!isUuid(input.engagementId)) return err('invalid');
  if (!isWorkingFileCategory(input.category)) return err('invalid');

  const [engagement] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: designEngagements.id, state: designEngagements.state })
      .from(designEngagements)
      .where(eq(designEngagements.id, input.engagementId))
      .limit(1),
  );
  if (!engagement) return err('engagement_not_found');
  if (isTerminal(engagement.state)) return err('engagement_not_active');

  const validation = validateDeliverableFile(
    input.category,
    input.originalName ?? '',
    input.sizeBytes,
  );
  if (validation) return err(validation);

  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, 'engagement', {
    entityId: input.engagementId,
    contentType: input.contentType,
    originalName: input.originalName,
  });
}

export interface AttachDeliverableInput {
  engagementId: string;
  category: WorkingFileCategory;
  fileId: string;
  label?: string | null;
}

/**
 * Attach an uploaded file to an engagement by recording the category's artifact
 * kind against it. Gated on `engagements_design` (create). Verifies the `files`
 * row is in-org AND stamped entity='engagement' with entity_id=engagementId
 * (else `invalid` — a foreign or wrong-entity file id cannot be smuggled in),
 * then delegates to recordArtifactCore, which re-asserts the engagement is in-org
 * and non-terminal and writes the attested artifact. Returns the new artifact id.
 */
export async function attachDeliverableCore(
  ctx: OrgContext,
  input: AttachDeliverableInput,
): Promise<ActionResult & { data?: string }> {
  if (!can(ctx.role, 'engagements_design', 'create')) return err('forbidden');
  if (!isUuid(input.engagementId) || !isUuid(input.fileId)) {
    return err('invalid');
  }
  if (!isWorkingFileCategory(input.category)) return err('invalid');

  const [owned] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.entity, 'engagement'),
          eq(files.entityId, input.engagementId),
        ),
      )
      .limit(1),
  );
  if (!owned) return err('invalid');

  return recordArtifactCore(ctx, {
    engagementId: input.engagementId,
    kind: CATEGORY_WRITE_KIND[input.category],
    fileId: input.fileId,
    label: input.label ?? null,
  });
}

/**
 * A time-limited (300s) signed download URL for a delivery deliverable. Gated on
 * `engagements_design` (read). Mirrors getClientDocumentUrl: only signs URLs for
 * this org's engagement files (in-org AND entity='engagement'), so the endpoint
 * cannot mint URLs for unrelated in-org files. `getSignedUrl` runs under RLS, so
 * a foreign file cannot be resolved (or signed).
 */
export async function getDeliverableUrlCore(
  ctx: OrgContext,
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  if (!can(ctx.role, 'engagements_design', 'read')) return err('forbidden');
  const [owned] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, 'engagement')))
      .limit(1),
  );
  if (!owned) return err('invalid');
  try {
    const url = await getSignedUrl(ctx, fileId, 300);
    return { ok: true, url };
  } catch {
    return err('invalid');
  }
}
