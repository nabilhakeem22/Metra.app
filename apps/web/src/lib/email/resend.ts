import 'server-only';
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
