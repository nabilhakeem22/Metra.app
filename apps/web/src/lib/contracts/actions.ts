'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { clientHomeAnswer } from '@/lib/client-home/home-link';
import type { ClientHomeAnswer } from '@/lib/client-home/types';
import type { OrgContext } from '@/lib/db/context';
import { requestLocaleOrDefault } from '@/lib/engagements/portal-url';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import {
  generateContractCore,
  generateExecutionContractCore,
  issueContractCore,
  recordContractSignedOfflineCore,
  saveContractDraftCore,
  setContractChargesCore,
  terminateContractCore,
  type GenerateExecutionContractInput,
  type RecordContractSignedOfflineInput,
  type SaveContractDraftInput,
  type SetContractChargesInput,
} from './core';
import { saveContractScheduleCore, type SaveContractScheduleInput } from './schedule/save';

export async function generateContract(
  proposalId: string,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await generateContractCore(ctx, { proposalId });
  if (res.ok) refreshApp();
  return res;
}

/** An execution contract from an issued BOQ, with its VAT and supervision rates. */
export async function generateExecutionContract(
  input: GenerateExecutionContractInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await generateExecutionContractCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function setContractCharges(input: SetContractChargesInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setContractChargesCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function saveContractSchedule(input: SaveContractScheduleInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await saveContractScheduleCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/** The client signed on paper: the studio records the day (owner decision D5). */
export async function recordContractSignedOffline(
  input: RecordContractSignedOfflineInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await recordContractSignedOfflineCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function saveContractDraft(
  input: SaveContractDraftInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await saveContractDraftCore(ctx, input);
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}

/**
 * Issue a draft contract and hand the studio what it sends the client. An
 * execution contract is signed in the client home with a code (H6.4), so the
 * answer carries the home (`clientHome`: its link, why there is none, or the
 * refusal) and never a /c link. The issue has committed by then, so a home
 * that fails is still `ok: true`, with the failure inside `clientHome` (the
 * Client page control retries). A proposal contract answers its /c link.
 */
export async function issueContract(id: string): Promise<ActionResult & { clientHome?: ClientHomeAnswer }> {
  const ctx = await requireOrg();
  // Resolve the link origin BEFORE the state change: an origin we cannot
  // resolve must not leave behind a committed transition whose link the caller
  // never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return unexpectedFailure('issueContract: no request origin');
  const res = await issueContractCore(ctx, { id });
  if (!res.ok) return res;
  if (!res.data) return unexpectedFailure('issueContractCore answered ok without a token');
  const answer = res.data.execution
    ? { ok: true, clientHome: await issuedContractHome(ctx, id.trim(), origin) }
    : { ok: true, link: `${origin}/${await requestLocaleOrDefault()}/c/${res.data.rawToken}` };
  refreshApp();
  return answer;
}

/** The just-issued contract's client home; a throw is a failure inside the answer, never a failed issue. */
async function issuedContractHome(ctx: OrgContext, contractId: string, origin: string): Promise<ClientHomeAnswer> {
  try {
    return await clientHomeAnswer(ctx, contractId, origin);
  } catch (error) {
    return unexpectedFailure('issueContract: client home', error);
  }
}

export async function terminateContract(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await terminateContractCore(ctx, { id });
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}
