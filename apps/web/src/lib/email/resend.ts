import 'server-only';
// Both values are read at REQUEST time (lib/cf/secrets): on Cloudflare they are
// Worker secrets rather than build-time vars, so rotating the Resend key is a
// `wrangler secret put` and not a redeploy.
import { runtimeSecret } from '@/lib/cf/secrets';
import { EMAIL_TIMEOUT_MS, withDeadline } from '@/lib/http/deadlines';
import {
  digestEmailTemplate,
  followupReminderEmailTemplate,
  stageReminderEmailTemplate,
  type EmailContent,
} from './templates/automation';
import { inviteEmailTemplate } from './templates/invite';
import { proposalSentEmailTemplate } from './templates/proposal-sent';

/**
 * ONE dispatch, so there is ONE place a timeout can be missing from.
 *
 * DEADLINED. Resend's SDK takes no AbortSignal, so the bound is on the WAIT: the
 * send is raced against a rejecting timer and a slow origin becomes
 * `{ sent: false }` instead of a server action held open until the platform
 * kills it. That matters most on the proposal path, which is awaited AFTER the
 * proposal has been sent and the share link minted — the studio must get their
 * answer whether or not Resend is having a day.
 *
 * NEVER THROWS. Every caller is best-effort by design: a missing key, a Resend
 * error and a deadline are all `{ sent: false }`, logged under the caller's own
 * label so the log still says which email it was.
 */
async function dispatchEmail(
  payload: { to: string; subject: string; html: string; text: string },
  label: string,
): Promise<{ sent: boolean }> {
  const apiKey = runtimeSecret('RESEND_API_KEY');
  const from = runtimeSecret('RESEND_FROM');
  if (!apiKey || !from) return { sent: false };
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const res = await withDeadline(
      resend.emails.send({ from, ...payload }),
      EMAIL_TIMEOUT_MS,
      label,
    );
    return { sent: !res.error };
  } catch (err) {
    console.error(`${label} failed:`, err);
    return { sent: false };
  }
}

export interface SendInviteEmailInput {
  to: string;
  orgName: string;
  acceptUrl: string;
  role: string;
  locale: string;
}

/**
 * Best-effort invite email. If RESEND_API_KEY / RESEND_FROM are unset, this is a
 * no-op (returns { sent: false }) — the flow falls back to the copyable invite
 * link surfaced in the Team page. Never throws.
 */
export function sendInviteEmail(
  input: SendInviteEmailInput,
): Promise<{ sent: boolean }> {
  return dispatchEmail(
    { to: input.to, ...inviteEmailTemplate(input) },
    'sendInviteEmail',
  );
}

export interface SendProposalEmailInput {
  to: string;
  orgName: string;
  proposalNumber: string;
  totalDisplay?: string | null;
  expiryDate?: string | null;
  acceptUrl: string;
  locale: string;
}

/**
 * Best-effort "proposal is ready" email to the client's stored address. If
 * RESEND_API_KEY / RESEND_FROM are unset it is a no-op ({ sent: false }); a
 * Resend error also returns { sent: false }. NEVER throws — sending a proposal
 * must not roll back just because the email failed. Contains no cost/margin.
 */
export function sendProposalEmail(
  input: SendProposalEmailInput,
): Promise<{ sent: boolean }> {
  return dispatchEmail(
    { to: input.to, ...proposalSentEmailTemplate(input) },
    'sendProposalEmail',
  );
}

/** Best-effort dispatch of a pre-built automation email. No key/from -> no-op. */
function sendAutomationEmail(
  to: string,
  content: EmailContent,
  label: string,
): Promise<{ sent: boolean }> {
  return dispatchEmail({ to, ...content }, label);
}

export function sendFollowupReminderEmail(input: {
  to: string;
  proposalNumber: string;
  days: number;
  reviewUrl: string;
  locale: string;
}): Promise<{ sent: boolean }> {
  return sendAutomationEmail(
    input.to,
    followupReminderEmailTemplate(input),
    'sendFollowupReminderEmail',
  );
}

export function sendDigestEmail(input: {
  to: string;
  activeProjects: number;
  awaitingResponse: number;
  expiringSoon: number;
  overdueStages: number;
  dashboardUrl: string;
  locale: string;
}): Promise<{ sent: boolean }> {
  return sendAutomationEmail(
    input.to,
    digestEmailTemplate(input),
    'sendDigestEmail',
  );
}

export function sendStageReminderEmail(input: {
  to: string;
  overdueCount: number;
  upcomingCount: number;
  projectsUrl: string;
  locale: string;
}): Promise<{ sent: boolean }> {
  return sendAutomationEmail(
    input.to,
    stageReminderEmailTemplate(input),
    'sendStageReminderEmail',
  );
}
