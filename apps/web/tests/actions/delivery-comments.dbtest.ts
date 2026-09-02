import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { setArtifactClientVisibilityCore } from '@/lib/engagements/client-visibility';
import { createEngagementCore } from '@/lib/engagements/core';
import {
  countAwaitingReplyCore,
  listDocumentCommentsCore,
  replyToDocumentCore,
} from '@/lib/engagements/document-comments';
import { getDeliveryByToken } from '@/lib/engagements/public';
import {
  addDeliveryCommentByToken,
  getDeliveryDocumentCommentsByToken,
} from '@/lib/engagements/public-comments';
import { mintDeliveryLinkCore, revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Client Deliverables, Step 2 — per-document comment threads. Two surfaces meet on
// one append-only table: the session-less CLIENT (token SDFs) and the authenticated
// STUDIO (RLS core). The recurring themes:
//   * NO ORACLE — a forged id, another delivery's document, an unreleased document
//     and a dead token are indistinguishable from an empty thread;
//   * ADVISORY — a comment moves no state and clears no gate;
//   * APPEND-ONLY — nobody can edit or delete a message, and "awaiting reply" is
//     therefore DERIVED, not a stored read flag.

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

/** Seed an org + client + project + ONE engagement with a live share link. */
async function seedDelivery(suffix: string): Promise<SeededDelivery> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: `Acme ${suffix}` });
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

/** Record a file-bearing artifact; release it to the client unless told not to. */
async function seedDocument(
  delivery: SeededDelivery,
  { release = true }: { release?: boolean } = {},
): Promise<string> {
  const res = await recordArtifactCore(delivery.ctx, {
    engagementId: delivery.engagementId,
    kind: 'approved_render',
    fileId: await seedFile(delivery.orgId, delivery.engagementId),
  });
  expect(res.ok).toBe(true);
  const artifactId = res.data!;
  if (release) {
    expect(
      (await setArtifactClientVisibilityCore(delivery.ctx, { artifactId, visible: true }))
        .ok,
    ).toBe(true);
  }
  return artifactId;
}

describe('client comments — the token write path', () => {
  it('appends a message the studio and the client both read back', async () => {
    const delivery = await seedDelivery('write');
    const documentId = await seedDocument(delivery);

    const sent = await addDeliveryCommentByToken(delivery.token, {
      documentId,
      body: '  الرخامة في المطبخ لونها غامق شوية  ',
      actorName: 'Mona',
      ip: '1.2.3.4',
      userAgent: 'probe/1',
    });
    expect(sent.ok).toBe(true);

    // The CLIENT reads it back, trimmed, attributed to the name they gave.
    const clientThread = await getDeliveryDocumentCommentsByToken(
      delivery.token,
      documentId,
    );
    expect(clientThread).toHaveLength(1);
    expect(clientThread[0].body).toBe('الرخامة في المطبخ لونها غامق شوية');
    expect(clientThread[0].channel).toBe('client');
    expect(clientThread[0].authorName).toBe('Mona');

    // The STUDIO reads the same message through RLS.
    const studioThread = await listDocumentCommentsCore(delivery.ctx, documentId);
    expect(studioThread).toHaveLength(1);
    expect(studioThread[0].channel).toBe('client');
    expect(studioThread[0].authorUserId).toBeNull();
  });

  it('rejects a blank body and never writes a row', async () => {
    const delivery = await seedDelivery('blank');
    const documentId = await seedDocument(delivery);

    expect(await addDeliveryCommentByToken(delivery.token, { documentId, body: '   ' }))
      .toEqual({ ok: false, error: 'empty' });
    expect(await listDocumentCommentsCore(delivery.ctx, documentId)).toHaveLength(0);
  });

  it('is NOT idempotent — two identical messages are two messages', async () => {
    // Unlike the respond/claim writers, which collapse a double submit. A repeated
    // question is a real thing a person does in a conversation.
    const delivery = await seedDelivery('repeat');
    const documentId = await seedDocument(delivery);
    const body = 'أي أخبار؟';
    expect((await addDeliveryCommentByToken(delivery.token, { documentId, body })).ok).toBe(true);
    expect((await addDeliveryCommentByToken(delivery.token, { documentId, body })).ok).toBe(true);
    expect(await listDocumentCommentsCore(delivery.ctx, documentId)).toHaveLength(2);
  });

  it('caps a runaway body at 2000 characters rather than raising', async () => {
    const delivery = await seedDelivery('long');
    const documentId = await seedDocument(delivery);
    const sent = await addDeliveryCommentByToken(delivery.token, {
      documentId,
      body: 'ا'.repeat(5000),
    });
    expect(sent.ok).toBe(true);
    const [stored] = await listDocumentCommentsCore(delivery.ctx, documentId);
    expect(stored.body).toHaveLength(2000);
  });

  it('stops at the flood ceiling of 20 client messages an hour', async () => {
    const delivery = await seedDelivery('flood');
    const documentId = await seedDocument(delivery);
    for (let i = 0; i < 20; i += 1) {
      expect(
        (await addDeliveryCommentByToken(delivery.token, { documentId, body: `m${i}` }))
          .ok,
      ).toBe(true);
    }
    expect(
      await addDeliveryCommentByToken(delivery.token, { documentId, body: 'one too many' }),
    ).toEqual({ ok: false, error: 'too_many' });
    expect(await listDocumentCommentsCore(delivery.ctx, documentId)).toHaveLength(20);
  });
});

describe('client comments — no oracle', () => {
  it('refuses a forged id, another delivery’s document, and an UNRELEASED one alike', async () => {
    const delivery = await seedDelivery('oracle-a');
    const other = await seedDelivery('oracle-b');
    const foreignId = await seedDocument(other);
    const unreleasedId = await seedDocument(delivery, { release: false });

    for (const documentId of [randomUUID(), foreignId, unreleasedId]) {
      expect(
        await addDeliveryCommentByToken(delivery.token, { documentId, body: 'hello' }),
      ).toEqual({ ok: false, error: 'token_invalid' });
      expect(
        await getDeliveryDocumentCommentsByToken(delivery.token, documentId),
      ).toEqual([]);
    }
    // A malformed (non-uuid) id is refused BEFORE the DB, with the same code.
    expect(
      await addDeliveryCommentByToken(delivery.token, {
        documentId: 'not-a-uuid',
        body: 'hello',
      }),
    ).toEqual({ ok: false, error: 'token_invalid' });
    // Nothing was written anywhere.
    expect(await listDocumentCommentsCore(other.ctx, foreignId)).toHaveLength(0);
  });

  it('goes silent once the share link is revoked', async () => {
    const delivery = await seedDelivery('revoked');
    const documentId = await seedDocument(delivery);
    expect(
      (await addDeliveryCommentByToken(delivery.token, { documentId, body: 'before' })).ok,
    ).toBe(true);

    expect((await revokeDeliveryLinkCore(delivery.ctx, delivery.engagementId)).ok).toBe(true);

    expect(
      await addDeliveryCommentByToken(delivery.token, { documentId, body: 'after' }),
    ).toEqual({ ok: false, error: 'token_invalid' });
    expect(await getDeliveryDocumentCommentsByToken(delivery.token, documentId)).toEqual(
      [],
    );
    // The message sent BEFORE the revoke is retained — append-only, not erased.
    expect(await listDocumentCommentsCore(delivery.ctx, documentId)).toHaveLength(1);
  });

  it('never leaks WHICH studio member replied', async () => {
    const delivery = await seedDelivery('anon');
    const documentId = await seedDocument(delivery);
    expect(
      (await replyToDocumentCore(delivery.ctx, { artifactId: documentId, body: 'تمام' }))
        .ok,
    ).toBe(true);

    const clientThread = await getDeliveryDocumentCommentsByToken(
      delivery.token,
      documentId,
    );
    expect(clientThread).toHaveLength(1);
    expect(clientThread[0].channel).toBe('staff');
    expect(clientThread[0].authorName).toBeNull();
    // The acting user's id is on the row for the studio, never on the wire.
    expect(JSON.stringify(clientThread)).not.toContain(delivery.ctx.userId);
    const [studioRow] = await listDocumentCommentsCore(delivery.ctx, documentId);
    expect(studioRow.authorUserId).toBe(delivery.ctx.userId);
  });
});

describe('studio replies — RLS and tenancy', () => {
  it('refuses to reply into ANOTHER org’s document', async () => {
    const mine = await seedDelivery('rls-mine');
    const theirs = await seedDelivery('rls-theirs');
    const foreignId = await seedDocument(theirs);

    expect(
      await replyToDocumentCore(mine.ctx, { artifactId: foreignId, body: 'trespass' }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(await listDocumentCommentsCore(theirs.ctx, foreignId)).toHaveLength(0);
    // And the foreign thread stays invisible to the other tenant's own read.
    expect(await listDocumentCommentsCore(mine.ctx, foreignId)).toHaveLength(0);
  });

  it('may reply on a document the client cannot see yet', async () => {
    // A studio note on a not-yet-released drawing is legitimate; it becomes visible
    // exactly when the file itself is released.
    const delivery = await seedDelivery('unreleased-reply');
    const documentId = await seedDocument(delivery, { release: false });
    expect(
      (await replyToDocumentCore(delivery.ctx, { artifactId: documentId, body: 'note' }))
        .ok,
    ).toBe(true);
    expect(await getDeliveryDocumentCommentsByToken(delivery.token, documentId)).toEqual(
      [],
    );
    expect(
      (await setArtifactClientVisibilityCore(delivery.ctx, { artifactId: documentId, visible: true })).ok,
    ).toBe(true);
    expect(
      await getDeliveryDocumentCommentsByToken(delivery.token, documentId),
    ).toHaveLength(1);
  });

  it('rejects a blank reply and a malformed artifact id', async () => {
    const delivery = await seedDelivery('reply-invalid');
    const documentId = await seedDocument(delivery);
    expect(
      await replyToDocumentCore(delivery.ctx, { artifactId: documentId, body: '  ' }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await replyToDocumentCore(delivery.ctx, { artifactId: 'nope', body: 'hi' }),
    ).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('awaiting reply — derived, never a stored read flag', () => {
  it('counts client messages with no studio message after them', async () => {
    const delivery = await seedDelivery('awaiting');
    const documentId = await seedDocument(delivery);
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(0);

    await addDeliveryCommentByToken(delivery.token, { documentId, body: 'q1' });
    await addDeliveryCommentByToken(delivery.token, { documentId, body: 'q2' });
    // Two unanswered questions read as TWO — that is the work outstanding.
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(2);

    // READING the thread must NOT clear it — only replying does.
    await listDocumentCommentsCore(delivery.ctx, documentId);
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(2);

    expect(
      (await replyToDocumentCore(delivery.ctx, { artifactId: documentId, body: 'اتظبط' }))
        .ok,
    ).toBe(true);
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(0);

    // A NEW client message after the reply is outstanding again.
    await addDeliveryCommentByToken(delivery.token, { documentId, body: 'q3' });
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(1);
  });

  it('is per-document — a reply on one drawing does not answer another', async () => {
    const delivery = await seedDelivery('per-doc');
    const first = await seedDocument(delivery);
    const second = await seedDocument(delivery);
    await addDeliveryCommentByToken(delivery.token, { documentId: first, body: 'a' });
    await addDeliveryCommentByToken(delivery.token, { documentId: second, body: 'b' });
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(2);

    await replyToDocumentCore(delivery.ctx, { artifactId: first, body: 'answered' });
    // The second drawing's question is still open.
    expect(await countAwaitingReplyCore(delivery.ctx, delivery.engagementId)).toBe(1);
  });

  it('does not count another org’s threads', async () => {
    const mine = await seedDelivery('count-mine');
    const theirs = await seedDelivery('count-theirs');
    const theirDoc = await seedDocument(theirs);
    await addDeliveryCommentByToken(theirs.token, { documentId: theirDoc, body: 'x' });
    expect(await countAwaitingReplyCore(mine.ctx, mine.engagementId)).toBe(0);
    expect(await countAwaitingReplyCore(theirs.ctx, theirs.engagementId)).toBe(1);
  });
});

describe('the snapshot count', () => {
  it('carries a per-document comment_count and NO message bodies', async () => {
    const delivery = await seedDelivery('snapshot');
    const documentId = await seedDocument(delivery);
    await addDeliveryCommentByToken(delivery.token, {
      documentId,
      body: 'SECRET-BODY-TEXT',
    });
    await replyToDocumentCore(delivery.ctx, { artifactId: documentId, body: 'ok' });

    const snapshot = await getDeliveryByToken(delivery.token);
    const doc = snapshot!.documents.find((d) => d.id === documentId);
    expect(doc?.commentCount).toBe(2);
    // The first paint must carry the COUNT only — the thread is a separate fetch.
    expect(JSON.stringify(snapshot)).not.toContain('SECRET-BODY-TEXT');
  });
});

describe('append-only', () => {
  it('grants metra_app no UPDATE and no DELETE on the comments table', async () => {
    // The load-bearing property behind "awaiting reply" being derived: there is no
    // seen_at to flip, because nothing on this table may be mutated at all.
    const rows = await raw.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where grantee = 'metra_app' and table_name = 'engagement_document_comments'`,
    );
    const granted = new Set(rows.map((r) => r.privilege_type));
    expect(granted.has('SELECT')).toBe(true);
    expect(granted.has('INSERT')).toBe(true);
    expect(granted.has('UPDATE')).toBe(false);
    expect(granted.has('DELETE')).toBe(false);
  });

  it('revokes EXECUTE from PUBLIC on both new token SDFs', async () => {
    // Same S1 class as every other app_* SDF: a holder of the anon key must not be
    // able to call these over PostgREST and bypass the app's own read layer.
    const rows = await raw.query<{ proname: string; public_exec: boolean }>(
      `select p.proname, has_function_privilege('public', p.oid, 'execute') as public_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('app_delivery_comment_by_token',
                           'app_delivery_document_comments_by_token')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.public_exec).toBe(false);
    }
  });
});
