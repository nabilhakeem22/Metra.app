import 'server-only';
// The transactional senders: each builds its template and hands it to the ONE
// deadlined dispatch (./dispatch.ts), which reads the Resend secrets at request
// time and never throws.
import { dispatchEmail } from './dispatch';
import {
  digestEmailTemplate,
  followupReminderEmailTemplate,
  stageReminderEmailTemplate,
  type EmailContent,
} from './templates/automation';
import { inviteEmailTemplate } from './templates/invite';
import { proposalSentEmailTemplate } from './templates/proposal-sent';

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
  deliveriesYourMove: number;
  deliveriesWaiting: number;
  deliveriesStalled: number;
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
