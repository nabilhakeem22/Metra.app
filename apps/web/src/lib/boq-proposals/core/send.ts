// "Send as BOQ": snapshot, map, render, then ONE write. PURE core — the
// 'use server' wrapper in ../actions does the session work.
import 'server-only';
import { err, type ActionCode, type ActionResult } from '@/lib/actions/result';
import { renderAndStoreClientBoqPdf } from '@/lib/boqs/issue';
import type { OrgContext } from '@/lib/db/context';
import { renderFailureCode } from '@/lib/pdf/render-failure-code';
import { can } from '@/lib/permissions/can';
import { toBoqDetail } from '../detail';
import { mapProposalToBoq, type MappedBoq } from '../map';
import { loadSendSnapshot, type SendSnapshot } from '../snapshot';
import { commitProposalBoqCore, type CommitProposalBoqInput } from './commit';

type StoredFile = { fileId: string; label: string };

/** The client PDF, numbered with the number the commit must allocate, or the
 *  refusal code (`renderer_busy` when it is worth retrying). */
async function renderClientCopy(
  ctx: OrgContext,
  snapshot: SendSnapshot,
  mapped: MappedBoq,
  locale: string,
): Promise<StoredFile | ActionCode> {
  const { proposal } = snapshot;
  const preferred = locale.startsWith('ar') ? proposal.titleAr : proposal.titleEn;
  const detail = toBoqDetail(
    mapped,
    {
      number: snapshot.nextBoqNumber,
      year: snapshot.renderYear,
      title: preferred ?? proposal.titleAr ?? proposal.titleEn ?? '',
      currency: proposal.currency,
      discountPct: proposal.discountPct,
    },
    { showCost: false },
  );
  try {
    return await renderAndStoreClientBoqPdf(ctx, {
      detail,
      engagementId: snapshot.engagement.id,
      locale,
      names: snapshot.names,
      year: snapshot.renderYear,
    });
  } catch (e) {
    return renderFailureCode(e, 'Send as BOQ');
  }
}

function commitInput(
  snapshot: SendSnapshot,
  mapped: MappedBoq,
  file: StoredFile,
): CommitProposalBoqInput {
  const { id: proposalId, revision, ...header } = snapshot.proposal;
  return {
    proposalId,
    expectedRevision: revision,
    expectedNumber: snapshot.nextBoqNumber,
    expectedYear: snapshot.renderYear,
    engagement: snapshot.engagement,
    header,
    mapped,
    file,
  };
}

/**
 * RENDER FIRST, WRITE ONCE. The client PDF is produced from the same mapped
 * object the commit writes, before any row exists, so a failed render (a 503 at
 * the renderer's cap is a normal event) writes nothing to the database and
 * leaves no draft BOQ behind; `metra_app` cannot delete one anyway. The commit's
 * fences turn any change between the snapshot and the write into
 * `boq_send_conflict`.
 *
 * A REPLAY RENDERS NOTHING: a revision that is already out is answered with the
 * BOQ it produced, from the snapshot, before Chromium is touched (and again under
 * the commit's lock, for a replay that races the first send).
 */
export async function sendProposalAsBoqCore(
  ctx: OrgContext,
  input: { proposalId: string; locale: string },
): Promise<ActionResult & { data?: { documentNumber: string } }> {
  if (!can(ctx.role, 'boq_build', 'create')) return err('forbidden');

  const snapshot = await loadSendSnapshot(ctx, input.proposalId);
  if (typeof snapshot === 'string') return err(snapshot);
  if ('alreadySent' in snapshot) {
    return { ok: true, data: { documentNumber: snapshot.alreadySent.documentNumber } };
  }
  const mapped = mapProposalToBoq(snapshot.source, snapshot.proposal.discountPct);

  const file = await renderClientCopy(ctx, snapshot, mapped, input.locale);
  if (typeof file === 'string') return err(file);

  const committed = await commitProposalBoqCore(ctx, commitInput(snapshot, mapped, file));
  if (!committed.ok || !committed.data) return { ok: false, error: committed.error ?? 'generic' };
  return { ok: true, data: { documentNumber: committed.data.documentNumber } };
}
