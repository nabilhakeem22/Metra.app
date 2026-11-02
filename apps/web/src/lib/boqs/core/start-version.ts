// A new version of an issued BOQ, from the BOQ tab: a draft with its titles, its
// sections and its lines, on the pair's one delivery, so the version goes out on
// the client's same link. X stays issued until the draft is issued and supersedes
// it (../issue/freeze.ts). PURE core: no next/*, no cookies.
import { boqLines, boqs, type MetraDb } from '@metra/db';
import { and, asc, count, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { requireDesignFinished } from '@/lib/engagements/pair-home';
import { isUuid } from '@/lib/uuid';
import { refuseIfContracted } from '../issue/freeze';
import { MAX_BOQ_LINES } from './create';
import { recomputeBoqTotals } from './recompute';
import { copyBoqContent } from './start-version-copy';

/**
 * The issued BOQ, FOR UPDATE: a generate still open on it (FOR SHARE) finishes
 * first, so the contract read that follows sees its contract; and a second call
 * waits here, so its read of the project's draft sees this one's.
 */
async function lockIssuedBoq(tx: MetraDb, boqId: string) {
  const [boq] = await tx
    .select({
      id: boqs.id,
      status: boqs.status,
      titleAr: boqs.titleAr,
      titleEn: boqs.titleEn,
      clientId: boqs.clientId,
      projectId: boqs.projectId,
      engagementId: boqs.engagementId,
      currency: boqs.currency,
      notesAr: boqs.notesAr,
      notesEn: boqs.notesEn,
      discountPct: boqs.discountPct,
    })
    .from(boqs)
    .where(eq(boqs.id, boqId))
    .limit(1)
    .for('update');
  if (!boq) fail('boq_not_found');
  if (boq.status !== 'issued') fail('boq_not_issued');
  return boq;
}

type IssuedBoq = Awaited<ReturnType<typeof lockIssuedBoq>>;

/** The delivery the version goes out through: the pair's home, or the refusal that says why there is none. */
async function requireHomeOf(tx: MetraDb, boq: IssuedBoq): Promise<string> {
  const gate = await requireDesignFinished(tx, { projectId: boq.projectId, clientId: boq.clientId });
  if (gate.kind === 'home') return gate.delivery.id;
  return fail(boq.engagementId === null ? 'boq_needs_delivery' : 'boq_delivery_abandoned');
}

async function refuseOversizedCopy(tx: MetraDb, boqId: string): Promise<void> {
  const [{ value }] = await tx.select({ value: count() }).from(boqLines).where(eq(boqLines.boqId, boqId));
  if (value > MAX_BOQ_LINES) fail('too_many_lines');
}

/** The project's draft, the oldest if old rows hold more than one (the current-BOQ rule among drafts). */
async function findDraftOf(tx: MetraDb, projectId: string): Promise<string | null> {
  const [draft] = await tx
    .select({ id: boqs.id })
    .from(boqs)
    .where(and(eq(boqs.projectId, projectId), eq(boqs.status, 'draft')))
    .orderBy(asc(boqs.createdAt))
    .limit(1);
  return draft?.id ?? null;
}

/**
 * Start a new version of an ISSUED BOQ with no live contract, on a pair whose
 * gate is `home`. A draft already on the project is the answer (no second one).
 * Refused: `boq_not_found` (another org's too), `boq_not_issued`,
 * `boq_has_contract`, `design_open`, `design_only_closed`,
 * `boq_delivery_abandoned`, `boq_needs_delivery`, `too_many_lines`. Lines are
 * copied value for value; the totals are then re-summed from them, as every
 * line write does. Returns the draft's id.
 */
export async function startBoqVersionCore(
  ctx: OrgContext,
  issuedBoqId: string,
): Promise<ActionResult & { data?: string }> {
  if (!isUuid(issuedBoqId)) return err('malformed');
  return mutateInOrg(ctx, { capability: 'boq_build', action: 'create' }, async (tx, audit) => {
    const issued = await lockIssuedBoq(tx, issuedBoqId);
    await refuseIfContracted(tx, [issued.id]);
    const engagementId = await requireHomeOf(tx, issued);
    await refuseOversizedCopy(tx, issued.id);

    const number = await allocateNumber(tx, ctx.orgId, 'boq', 'boqs', 'number');
    const existing = await findDraftOf(tx, issued.projectId);
    if (existing) return existing;

    const [draft] = await tx
      .insert(boqs)
      .values({
        orgId: ctx.orgId,
        number,
        titleAr: issued.titleAr,
        titleEn: issued.titleEn,
        clientId: issued.clientId,
        projectId: issued.projectId,
        engagementId,
        currency: issued.currency,
        notesAr: issued.notesAr,
        notesEn: issued.notesEn,
        discountPct: issued.discountPct,
      })
      .returning({ id: boqs.id });
    await copyBoqContent(tx, { orgId: ctx.orgId, fromBoqId: issued.id, toBoqId: draft.id });
    await recomputeBoqTotals(tx, draft.id, issued.discountPct);
    await audit({
      entity: 'boq',
      entityId: draft.id,
      action: 'create',
      before: null,
      after: { number, new_version_of: issued.id, engagement_id: engagementId },
    });
    return draft.id;
  });
}
