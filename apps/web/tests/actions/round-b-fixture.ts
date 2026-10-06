// Shared setup for the Round B database suites (migration 0056 and its apply-rls
// functions). Not a test file: it is imported by `delivery-portal-round-b.dbtest.ts`
// and `delivery-notify-studio.dbtest.ts` and runs inside their runner.
//
// The two NEW functions have no TypeScript wrapper yet (PR-B10 and PR-B12 build
// them), so they are called here over the BYPASSRLS connection exactly as the
// wrappers will call them: by the sha256 hash of the raw share token.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { MemberRole } from '@metra/db';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { setArtifactClientVisibilityCore } from '@/lib/engagements/client-visibility';
import { createEngagementCore } from '@/lib/engagements/core';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { hashShareToken } from '@/lib/share/token';
import { ctxFor, raw, seedOrg } from './fixture';

export interface RoundBDelivery {
  ctx: OrgContext;
  orgId: string;
  ownerId: string;
  /** In the order `members` was given. */
  memberIds: string[];
  engagementId: string;
  token: string;
  hash: string;
}

/** An org with one owner (+ members), one client, one project, ONE delivery with a live link. */
export async function seedRoundBDelivery(
  orgIds: string[],
  suffix: string,
  members: Array<{ role: MemberRole }> = [],
): Promise<RoundBDelivery> {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: `Acme ${suffix}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: `Villa ${suffix}`,
    titleAr: 'فيلا',
    clientId: client.id,
    projectId: project.id,
  });
  expect(created.ok).toBe(true);
  const engagementId = (created as { data?: string }).data!;
  const minted = await mintDeliveryLinkCore(ctx, engagementId);
  expect(minted.ok).toBe(true);
  const token = minted.data!;
  return {
    ctx,
    orgId,
    ownerId: ownerIds[0],
    memberIds,
    engagementId,
    token,
    hash: hashShareToken(token),
  };
}

/** Force a delivery into a state directly (BYPASSRLS), as the other portal suites do. */
export async function forceState(engagementId: string, state: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${engagementId}'`,
  );
}

/** Stamp renders_ready_at with a SQL expression: one render issuance ("round"). */
export async function stampRenders(engagementId: string, instantSql: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set renders_ready_at = ${instantSql}
      where id = '${engagementId}'`,
  );
}

/** renders_ready_at as text: microseconds survive, which a JS Date would drop. */
export async function rendersReadyAtText(engagementId: string): Promise<string | null> {
  const [row] = await raw.query<{ at: string | null }>(
    `select renders_ready_at::text as at from public.design_engagements
      where id = '${engagementId}'`,
  );
  return row.at;
}

/** The portal snapshot, straight from the read function. */
export async function snapshotOf(hash: string): Promise<Record<string, unknown> | null> {
  const [row] = await raw.query<{ data: Record<string, unknown> | null }>(
    `select public.app_delivery_by_token('${hash}') as data`,
  );
  return row.data;
}

export async function clientActionsOf(hash: string): Promise<string[]> {
  const snapshot = await snapshotOf(hash);
  return (snapshot?.client_actions as string[] | undefined) ?? [];
}

/** Call the concept-choice function exactly as the PR-B12 wrapper will. */
export async function chooseConcept(
  hash: string,
  artifactId: string | null,
  note: string | null = null,
): Promise<string> {
  const artifact = artifactId === null ? 'null' : `'${artifactId}'::uuid`;
  const noteSql = note === null ? 'null' : `'${note}'`;
  const [row] = await raw.query<{ code: string }>(
    `select public.app_delivery_choose_concept_by_token(
       '${hash}', ${artifact}, ${noteSql}, 'Client Sam', '1.2.3.4', 'probe/1'
     ) as code`,
  );
  return row.code;
}

/** Back-date updated_at so a later refresh is visible regardless of clock resolution. */
export async function ageUpdatedAt(engagementId: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set updated_at = '2000-01-01T00:00:00Z'
      where id = '${engagementId}'`,
  );
}

/** True when updated_at moved off the back-dated value. */
export async function updatedAtRefreshed(engagementId: string): Promise<boolean> {
  const [row] = await raw.query<{ fresh: boolean }>(
    `select updated_at > timestamptz '2001-01-01' as fresh
       from public.design_engagements where id = '${engagementId}'`,
  );
  return row.fresh;
}

/** A stored file of this delivery, so an artifact can be released to the client. */
export async function seedFile(orgId: string, engagementId: string): Promise<string> {
  const fileId = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, bucket, object_key, original_name)
     values ('${fileId}', '${orgId}', 'engagement', '${engagementId}',
             'metra-files', '${orgId}/engagement/${fileId}', 'Option.png')`,
  );
  return fileId;
}

/**
 * Record an artifact through the real core. `withFile` attaches a stored file;
 * `release` then makes it client-visible through the real visibility core.
 */
export async function seedArtifact(
  delivery: RoundBDelivery,
  kind: 'concept_option' | 'approved_render',
  { withFile = true, release = true }: { withFile?: boolean; release?: boolean } = {},
): Promise<string> {
  const fileId = withFile ? await seedFile(delivery.orgId, delivery.engagementId) : undefined;
  const recorded = await recordArtifactCore(delivery.ctx, {
    engagementId: delivery.engagementId,
    kind,
    fileId,
  });
  expect(recorded.ok).toBe(true);
  const artifactId = recorded.data!;
  if (release) {
    const released = await setArtifactClientVisibilityCore(delivery.ctx, {
      artifactId,
      visible: true,
    });
    expect(released.ok).toBe(true);
  }
  return artifactId;
}
