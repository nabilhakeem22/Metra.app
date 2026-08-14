import 'server-only';
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
export async function sendInviteEmail(
  input: SendInviteEmailInput,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    return { sent: false };
  }

  try {
    const { subject, html, text } = inviteEmailTemplate(input);
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const res = await resend.emails.send({
      from,
      to: input.to,
      subject,
      html,
      text,
    });
    return { sent: !res.error };
  } catch (err) {
    console.error('sendInviteEmail failed:', err);
    return { sent: false };
  }
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
export async function sendProposalEmail(
  input: SendProposalEmailInput,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    return { sent: false };
  }

  try {
    const { subject, html, text } = proposalSentEmailTemplate(input);
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const res = await resend.emails.send({
      from,
      to: input.to,
      subject,
      html,
      text,
    });
    return { sent: !res.error };
  } catch (err) {
    console.error('sendProposalEmail failed:', err);
    return { sent: false };
  }
}

/** Best-effort dispatch of a pre-built automation email. No key/from -> no-op. */
async function sendAutomationEmail(
  to: string,
  content: EmailContent,
  label: string,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return { sent: false };
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const res = await resend.emails.send({
      from,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    return { sent: !res.error };
  } catch (err) {
    console.error(`${label} failed:`, err);
    return { sent: false };
  }
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
