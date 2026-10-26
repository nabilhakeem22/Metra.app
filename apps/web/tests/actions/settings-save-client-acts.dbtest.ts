import { createSql } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { claimPaymentByToken } from './design-claim-sdf';
import { addDeliveryCommentByToken } from '@/lib/engagements/public-comments';
import type { ClientPageDetails } from '@/lib/org/client-page-details';
import { updateClientPageDetailsCore } from '@/lib/org/client-page-details-core';
import { clientPageRevision } from '@/lib/org/client-page-revision';
import { closeFixture, raw, teardown } from './fixture';
import { seedArtifact, seedFeeSchedule, seedRoundBDelivery } from './round-b-fixture';

// Round E R2: a Settings save holds the studio's organizations row while it
// runs, and every client act INSERTs a row whose org_id foreign key takes FOR
// KEY SHARE on that row. The save locks FOR NO KEY UPDATE, which does not
// conflict, so a client's comment or payment claim does not wait for a slow (or
// abandoned) save. Under FOR UPDATE it waited for the save to finish, and with
// 0060's 4 s lock_timeout on the token writes it would fail every client act of
// the studio. The REAL save core is held mid-transaction, after it has locked
// and updated the row: a second connection holds the audit table, which the
// save writes next.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Not waiting on the save: an answer well under the 4 s a token write may wait. */
const PROMPT_MS = 1_500;

async function saveBlockedOnAudit(): Promise<boolean> {
  const [row] = await raw.query<{ waiting: number }>(
    `select count(*)::int as waiting from pg_stat_activity
      where wait_event_type = 'Lock' and query ilike '%insert into "audit_log"%'`,
  );
  return row.waiting > 0;
}

describe('a Settings save in progress and the client acts of the same studio (R2)', () => {
  it('a comment and a payment claim answer at once while the save holds the org row', async () => {
    const d = await seedRoundBDelivery(orgIds, 'r2-settings');
    const documentId = await seedArtifact(d, 'approved_render');
    await seedFeeSchedule(d);
    const [stored] = await raw.query<ClientPageDetails>(
      `select studio_phone as "studioPhone", studio_whatsapp as "studioWhatsapp", instapay_address as "instapayAddress",
              bank_name as "bankName", bank_account_holder as "bankAccountHolder",
              bank_account_number as "bankAccountNumber", bank_iban as "bankIban"
         from public.organizations where id = '${d.orgId}'`,
    );

    const holder = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const auditHeld = new Promise<void>((resolve) => (locked = resolve));
    const holding = holder.begin(async (tx) => {
      await tx.unsafe('lock table public.audit_log in share mode');
      locked();
      await released;
    });
    try {
      await auditHeld;
      const saving = updateClientPageDetailsCore(d.ctx, {
        revision: clientPageRevision(stored),
        changes: { studioPhone: '01012345678' },
      });
      while (!(await saveBlockedOnAudit())) await new Promise((resolve) => setTimeout(resolve, 25));

      // The save really holds the row: a FOR UPDATE that will not wait is refused.
      const probe = await raw
        .query(`select 1 from public.organizations where id = '${d.orgId}' for update nowait`)
        .then(() => 'ok', (error: unknown) => sqlstateOf(error));
      expect(probe).toBe('55P03');

      const startedAt = Date.now();
      const comment = await addDeliveryCommentByToken(d.token, { documentId, body: 'Is the wall moving?' });
      const claim = await claimPaymentByToken(d.token, { milestoneKind: 'deposit' });
      const elapsed = Date.now() - startedAt;
      expect(comment).toEqual({ ok: true });
      expect(claim).toEqual({ ok: true });
      expect(elapsed, `both acts answered in ${elapsed} ms`).toBeLessThan(PROMPT_MS);

      release();
      await holding;
      expect((await saving).ok).toBe(true);
    } finally {
      release();
      await holding.catch(() => undefined);
      await holder.end();
    }
  }, 60_000);
});
