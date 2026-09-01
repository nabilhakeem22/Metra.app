import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { setArtifactClientVisibilityCore } from '@/lib/engagements/client-visibility';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { getDeliveryDocumentByToken } from '@/lib/engagements/public-documents';
import { recordPaymentCore } from '@/lib/engagements/payments';
import {
  mintDeliveryLinkCore,
  revokeDeliveryLinkCore,
} from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Client Deliverables, Step 1 — the tokenized PORTAL surface: the `documents` key on
// the read snapshot and the `app_delivery_document_by_token` resolver behind the
// download route. The recurring theme is NO ORACLE: a forged id, a foreign
// delivery's artifact, an unreleased artifact and a dead token must all resolve to
// the SAME null.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface SeededDelivery {
  ctx: OrgContext;
  orgId: string;
  engagementId: string;
  token: string;
}

async function seedFile(orgId: string, engagementId: string): Promise<string> {
  const fileId = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, bucket, object_key, original_name)
     values ('${fileId}', '${orgId}', 'engagement', '${engagementId}',
             'metra-files', '${orgId}/engagement/${fileId}', 'Internal name.PDF')`,
  );
  return fileId;
}

/** Record one artifact (optionally with a real file) and return its id. */
async function recordArtifact(
  ctx: OrgContext,
  engagementId: string,
  kind: Parameters<typeof recordArtifactCore>[1]['kind'],
  fileId: string | null,
): Promise<string> {
  const res = await recordArtifactCore(ctx, { engagementId, kind, fileId });
  expect(res.ok).toBe(true);
  return res.data!;
}

/** Seed an org + client + project + ONE engagement with a live share link. */
async function seedDelivery(suffix: string): Promise<SeededDelivery> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: `Acme ${suffix}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  const minted = await mintDeliveryLinkCore(ctx, engagementId);
  expect(minted.ok).toBe(true);
  return { ctx, orgId, engagementId, token: minted.data! };
}

/** Record a file-bearing artifact and RELEASE it via the manual override. */
async function seedVisibleDocument(
  delivery: SeededDelivery,
  kind: Parameters<typeof recordArtifactCore>[1]['kind'] = 'approved_render',
): Promise<string> {
  const artifactId = await recordArtifact(
    delivery.ctx,
    delivery.engagementId,
    kind,
    await seedFile(delivery.orgId, delivery.engagementId),
  );
  expect(
    (await setArtifactClientVisibilityCore(delivery.ctx, { artifactId, visible: true }))
      .ok,
  ).toBe(true);
  return artifactId;
}

describe('portal documents — the released list on the token snapshot', () => {
  it('lists ONLY released, file-bearing artifacts, with no label / filename / size', async () => {
    const delivery = await seedDelivery('list');
    const visibleId = await seedVisibleDocument(delivery, 'approved_render');
    // Released but FILELESS: excluded (the SDF joins `files`). The core refuses to
    // mark it visible, so flip it directly to prove the SDF is the second gate.
    const filelessId = await recordArtifact(
      delivery.ctx,
      delivery.engagementId,
      'approved_render',
      null,
    );
    await raw.query(
      `update public.engagement_artifacts set client_visible = true
       where id = '${filelessId}'`,
    );
    // File-bearing but NOT released.
    const hiddenId = await recordArtifact(
      delivery.ctx,
      delivery.engagementId,
      'boq',
      await seedFile(delivery.orgId, delivery.engagementId),
    );

    const snapshot = await getDeliveryByToken(delivery.token);
    expect(snapshot).not.toBeNull();
    const ids = snapshot!.documents.map((d) => d.id);
    expect(ids).toEqual([visibleId]);
    expect(snapshot!.documents[0].category).toBe('render');

    expect(ids).not.toContain(filelessId);
    expect(ids).not.toContain(hiddenId);

    // Nothing internal crosses the wire.
    const json = JSON.stringify(snapshot!.documents);
    expect(json).not.toContain('Internal name');
    expect(json).not.toContain('label');
    expect(json).not.toContain('object_key');
    expect(json).not.toContain('size');
  });

  it('an engagement with nothing released reports an EMPTY document list', async () => {
    const delivery = await seedDelivery('empty');
    await recordArtifact(
      delivery.ctx,
      delivery.engagementId,
      'boq',
      await seedFile(delivery.orgId, delivery.engagementId),
    );
    const snapshot = await getDeliveryByToken(delivery.token);
    expect(snapshot!.documents).toEqual([]);
  });
});

describe('portal documents — the download resolver has no oracle', () => {
  it('resolves a released document to a bucket/key + a category download name', async () => {
    const delivery = await seedDelivery('hit');
    const artifactId = await seedVisibleDocument(delivery, 'shop_drawing');

    const target = await getDeliveryDocumentByToken(delivery.token, artifactId);
    expect(target).not.toBeNull();
    expect(target!.bucket).toBe('metra-files');
    expect(target!.objectKey).toContain(`${delivery.orgId}/engagement/`);
    // The client's copy is named for what the file IS, never the studio's filename.
    expect(target!.downloadName).toBe('shop-drawing.pdf');
    expect(target!.downloadName).not.toContain('Internal');
  });

  it('a FORGED uuid resolves to null', async () => {
    const delivery = await seedDelivery('forged');
    await seedVisibleDocument(delivery);
    await expect(
      getDeliveryDocumentByToken(delivery.token, randomUUID()),
    ).resolves.toBeNull();
  });

  it("ANOTHER delivery's artifact, presented with a valid token, resolves to null", async () => {
    const a = await seedDelivery('cross-a');
    const b = await seedDelivery('cross-b');
    const documentOfB = await seedVisibleDocument(b);
    await seedVisibleDocument(a);

    // A's token + B's (released!) artifact id -> null. The id is only a filter
    // inside the delivery the token proved.
    await expect(
      getDeliveryDocumentByToken(a.token, documentOfB),
    ).resolves.toBeNull();
    // B's own token still resolves it, proving the id itself is valid.
    await expect(
      getDeliveryDocumentByToken(b.token, documentOfB),
    ).resolves.not.toBeNull();
  });

  it('an artifact of another delivery in the SAME org still resolves to null', async () => {
    const delivery = await seedDelivery('same-org');
    const [client] = await listClients(delivery.ctx, {});
    // A SECOND project: only one active delivery may exist per project.
    await createProjectCore(delivery.ctx, {
      code: `PRJ2-${delivery.orgId.slice(0, 8)}`,
      nameEn: 'Annex',
      clientId: client.id,
      status: 'active',
    });
    const siblingProject = (await listProjects(delivery.ctx, {})).find(
      (p) => p.nameEn === 'Annex',
    )!;
    const sibling = await createEngagementCore(delivery.ctx, {
      titleEn: 'Second villa',
      clientId: client.id,
      projectId: siblingProject.id,
    });
    const siblingId = (sibling as { data?: string }).data!;
    const siblingArtifact = await recordArtifact(
      delivery.ctx,
      siblingId,
      'approved_render',
      await seedFile(delivery.orgId, siblingId),
    );
    await raw.query(
      `update public.engagement_artifacts set client_visible = true
       where id = '${siblingArtifact}'`,
    );

    await expect(
      getDeliveryDocumentByToken(delivery.token, siblingArtifact),
    ).resolves.toBeNull();
  });

  it('a HIDDEN (client_visible=false) artifact resolves to null', async () => {
    const delivery = await seedDelivery('hidden');
    const artifactId = await seedVisibleDocument(delivery);
    expect(await getDeliveryDocumentByToken(delivery.token, artifactId)).not.toBeNull();

    expect(
      (
        await setArtifactClientVisibilityCore(delivery.ctx, {
          artifactId,
          visible: false,
        })
      ).ok,
    ).toBe(true);
    await expect(
      getDeliveryDocumentByToken(delivery.token, artifactId),
    ).resolves.toBeNull();
    // …and it drops off the portal list too.
    const snapshot = await getDeliveryByToken(delivery.token);
    expect(snapshot!.documents).toEqual([]);
  });

  it('a REVOKED token resolves to null', async () => {
    const delivery = await seedDelivery('revoked');
    const artifactId = await seedVisibleDocument(delivery);
    expect(await getDeliveryDocumentByToken(delivery.token, artifactId)).not.toBeNull();

    expect((await revokeDeliveryLinkCore(delivery.ctx, delivery.engagementId)).ok).toBe(
      true,
    );
    await expect(
      getDeliveryDocumentByToken(delivery.token, artifactId),
    ).resolves.toBeNull();
  });

  it('an EXPIRED token resolves to null', async () => {
    const delivery = await seedDelivery('expired');
    const artifactId = await seedVisibleDocument(delivery);
    await raw.query(
      `update public.design_engagements
         set share_expires_at = now() - interval '1 day'
       where id = '${delivery.engagementId}'`,
    );
    await expect(
      getDeliveryDocumentByToken(delivery.token, artifactId),
    ).resolves.toBeNull();
  });

  it('an UNKNOWN token resolves to null', async () => {
    const delivery = await seedDelivery('unknown');
    const artifactId = await seedVisibleDocument(delivery);
    await expect(
      getDeliveryDocumentByToken('this-token-was-never-minted', artifactId),
    ).resolves.toBeNull();
  });

  // S2 backstop. `engagement_artifacts.file_id` carries no FK, so the ONLY thing
  // stopping a cross-tenant file reaching a client portal is the SDF's
  // `f.org_id = a.org_id` join. recordArtifactCore now refuses to write such a row,
  // so this forges it directly over the BYPASSRLS connection: the point is to pin
  // the join itself, independently of the core, so a future refactor of either one
  // cannot silently open the hole.
  it('an artifact pointing at ANOTHER org’s file resolves to null (org join pinned)', async () => {
    const a = await seedDelivery('file-cross-a');
    const b = await seedDelivery('file-cross-b');
    const foreignFileId = await seedFile(b.orgId, b.engagementId);

    // Forge: an org-A artifact whose file_id belongs to org B, released to A's client.
    const forgedId = randomUUID();
    await raw.query(
      `insert into public.engagement_artifacts
         (id, org_id, engagement_id, kind, file_id, attested_by, client_visible)
       values ('${forgedId}', '${a.orgId}', '${a.engagementId}', 'approved_render',
               '${foreignFileId}', '${a.ctx.userId}', true)`,
    );

    // The row exists and is flagged visible…
    const [forged] = await raw.query<{ client_visible: boolean }>(
      `select client_visible from public.engagement_artifacts where id = '${forgedId}'`,
    );
    expect(forged.client_visible).toBe(true);

    // …but neither surface will resolve it, because the file is another org's.
    await expect(
      getDeliveryDocumentByToken(a.token, forgedId),
    ).resolves.toBeNull();
    const snapshot = await getDeliveryByToken(a.token);
    expect(snapshot!.documents.map((d) => d.id)).not.toContain(forgedId);
  });

  it('recordArtifactCore REFUSES a cross-org file id (S2 primary gate)', async () => {
    const a = await seedDelivery('file-gate-a');
    const b = await seedDelivery('file-gate-b');
    const foreignFileId = await seedFile(b.orgId, b.engagementId);

    expect(
      await recordArtifactCore(a.ctx, {
        engagementId: a.engagementId,
        kind: 'approved_render',
        fileId: foreignFileId,
      }),
    ).toEqual({ ok: false, error: 'invalid' });

    // …and a file stamped to a DIFFERENT engagement in the caller's own org.
    const otherEngagementFile = await seedFile(a.orgId, randomUUID());
    expect(
      await recordArtifactCore(a.ctx, {
        engagementId: a.engagementId,
        kind: 'approved_render',
        fileId: otherEngagementFile,
      }),
    ).toEqual({ ok: false, error: 'invalid' });

    // …and a malformed file id is `invalid`, never a cast error.
    expect(
      await recordArtifactCore(a.ctx, {
        engagementId: a.engagementId,
        kind: 'approved_render',
        fileId: 'not-a-uuid',
      }),
    ).toEqual({ ok: false, error: 'invalid' });

    const rows = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.engagement_artifacts
       where engagement_id = '${a.engagementId}'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

/**
 * EVERY public token SECURITY DEFINER function, with its exact argument list. The
 * class-wide invariant (S1): a token SDF must NEVER be callable by PUBLIC or by the
 * Supabase api roles — CREATE FUNCTION grants EXECUTE to PUBLIC by DEFAULT, so
 * without an explicit revoke in rls/roles.sql anyone holding the project's anon key
 * could call these directly over PostgREST and bypass the app's own read layer. The
 * `*_respond_/_ack_/_claim_` variants additionally take caller-supplied
 * p_name/p_ip/p_ua that are written into append-only ledgers (audit poisoning).
 *
 * Table-driven ON PURPOSE: adding a new token SDF is a ONE-LINE addition here, and
 * forgetting its revoke then fails this suite instead of shipping.
 */
const TOKEN_SDFS: ReadonlyArray<{ name: string; args: string }> = [
  // Not a public SHARE token (it backs the invitation-accept flow), but it is
  // resolved by token hash and was already locked down — included so the discovery
  // check below can be exhaustive over `app_*_by_token` with no exceptions list.
  { name: 'app_invitation_by_token', args: 'text' },
  { name: 'app_proposal_by_token', args: 'text' },
  { name: 'app_proposal_respond_by_token', args: 'text, text, text, text, text' },
  { name: 'app_contract_by_token', args: 'text' },
  { name: 'app_contract_ack_by_token', args: 'text, text, text, text, text' },
  { name: 'app_variation_by_token', args: 'text' },
  { name: 'app_variation_respond_by_token', args: 'text, text, text, text, text' },
  { name: 'app_delivery_by_token', args: 'text' },
  { name: 'app_delivery_document_by_token', args: 'text, uuid' },
  {
    name: 'app_delivery_respond_by_token',
    args: 'text, text, text, text, text, text',
  },
  {
    name: 'app_delivery_claim_payment_by_token',
    args: 'text, text, text, text, text, text',
  },
  // Client Deliverables Step 2 — per-document comment threads. The reader is in
  // this class because it returns client-authored message BODIES; the writer
  // because it takes caller-supplied p_name/p_ip/p_ua written into an append-only
  // ledger, the same audit-poisoning surface as the respond/claim variants.
  { name: 'app_delivery_document_comments_by_token', args: 'text, uuid' },
  {
    name: 'app_delivery_comment_by_token',
    args: 'text, uuid, text, text, text, text',
  },
];

function signatureOf(sdf: { name: string; args: string }): string {
  return `public.${sdf.name}(${sdf.args})`;
}

describe('token SDFs are not EXECUTE TO PUBLIC (S1, whole class)', () => {
  it('covers EVERY app_*_by_token function that exists in the database', async () => {
    // Guards against the table drifting behind functions.sql: if someone adds a new
    // token SDF and does not list it above, this fails and points at the name.
    const rows = await raw.query<{ proname: string }>(
      `select distinct p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname like 'app\\_%\\_by\\_token'`,
    );
    const discovered = rows.map((r) => r.proname).sort();
    const declared = TOKEN_SDFS.map((s) => s.name).sort();
    expect(discovered).toEqual(declared);
  });

  it('NONE of them grants EXECUTE to PUBLIC', async () => {
    const rows = await raw.query<{
      proname: string;
      has_acl: boolean;
      public_execute: boolean;
    }>(
      `select p.proname,
              p.proacl is not null as has_acl,
              exists (
                select 1 from aclexplode(p.proacl) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ) as public_execute
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname in (${TOKEN_SDFS.map((s) => `'${s.name}'`).join(', ')})`,
    );
    expect(rows.length).toBe(TOKEN_SDFS.length);
    for (const row of rows) {
      // A NULL proacl means "defaults apply", and CREATE FUNCTION's default IS
      // EXECUTE TO PUBLIC — so a null acl is a FAILURE, not a pass.
      expect({ fn: row.proname, hasAcl: row.has_acl }).toEqual({
        fn: row.proname,
        hasAcl: true,
      });
      expect({ fn: row.proname, publicExecute: row.public_execute }).toEqual({
        fn: row.proname,
        publicExecute: false,
      });
    }
  });

  it('the Supabase api roles cannot execute them either (when those roles exist)', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const [present] = await raw.query<{ n: number }>(
        `select count(*)::int as n from pg_roles where rolname = '${role}'`,
      );
      // A plain Postgres (CI) has no Supabase api roles — nothing to assert there.
      if (Number(present.n) === 0) continue;
      for (const sdf of TOKEN_SDFS) {
        const signature = signatureOf(sdf);
        const [row] = await raw.query<{ allowed: boolean }>(
          `select has_function_privilege('${role}', '${signature}', 'execute') as allowed`,
        );
        expect({ role, signature, allowed: row.allowed }).toEqual({
          role,
          signature,
          allowed: false,
        });
      }
    }
  });

  it('metra_app CAN execute all of them (the app path is not broken by the revokes)', async () => {
    for (const sdf of TOKEN_SDFS) {
      const signature = signatureOf(sdf);
      const [row] = await raw.query<{ allowed: boolean }>(
        `select has_function_privilege('metra_app', '${signature}', 'execute') as allowed`,
      );
      expect({ signature, allowed: row.allowed }).toEqual({ signature, allowed: true });
    }
  });
});

describe('portal documents — auto-share reaches the portal end to end', () => {
  it('optionsReady publishes the concept package and never the BOQ', async () => {
    const delivery = await seedDelivery('e2e');
    const { ctx, orgId, engagementId, token } = delivery;

    // Drive to `layout` (the release edge's `from` state).
    expect(
      (
        await executeTransition(ctx, {
          engagementId,
          trigger: 'submitDesignFee',
          payload: {
            designFee: '100000',
            milestones: [
              { kind: 'deposit', basis: 'amount', value: '30000' },
              { kind: 'gate_a', basis: 'amount', value: '20000' },
              { kind: 'gate_b', basis: 'amount', value: '20000' },
              { kind: 'balance', basis: 'amount', value: '30000' },
            ],
          },
        })
      ).ok,
    ).toBe(true);
    await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' }))
        .ok,
    ).toBe(true);
    await recordArtifact(ctx, engagementId, 'survey', await seedFile(orgId, engagementId));
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' })).ok,
    ).toBe(true);

    const optionA = await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    const optionB = await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    const boq = await recordArtifact(
      ctx,
      engagementId,
      'boq',
      await seedFile(orgId, engagementId),
    );

    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok,
    ).toBe(true);

    const snapshot = await getDeliveryByToken(token);
    const ids = snapshot!.documents.map((d) => d.id).sort();
    expect(ids).toEqual([optionA, optionB].sort());
    expect(ids).not.toContain(boq);
    for (const document of snapshot!.documents) {
      expect(document.category).toBe('concept');
      expect(document.sharedAt).toBeTruthy();
    }
    await expect(getDeliveryDocumentByToken(token, boq)).resolves.toBeNull();
  });
});

describe('portal documents — safe by construction (AC4)', () => {
  it('neither delivery SDF references any cost/margin column', async () => {
    const rows = await raw.query<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc
        where proname in ('app_delivery_by_token', 'app_delivery_document_by_token')`,
    );
    expect(rows.length).toBe(2);
    const FORBIDDEN = /unit_cost|line_cost|total_cost|margin|supervision|build_cost/;
    for (const row of rows) {
      expect(FORBIDDEN.test(row.prosrc)).toBe(false);
    }
  });

  it('neither SDF even mentions the word cost anywhere in its source', async () => {
    const rows = await raw.query<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc
        where proname in ('app_delivery_by_token', 'app_delivery_document_by_token')`,
    );
    for (const row of rows) {
      expect(/cost/i.test(row.prosrc)).toBe(false);
    }
  });
});
