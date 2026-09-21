import 'server-only';
// The client email that FOLLOWS a proposal send.
//
// BEST-EFFORT, and that is the contract: by the time this runs the core has
// already committed, the proposal IS sent and the studio already has the link.
// A missing address, a failed meta load or a Resend outage must therefore never
// throw and never roll anything back — it reports what happened and stops.
//
// NOT a server action: a `'use server'` module may export only async functions
// and every export becomes a callable RPC endpoint. This is the body behind one.
import { organizations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { sendProposalEmail } from '@/lib/email/resend';
import { formatMoney } from '@/lib/format/money';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { getProposalSendMeta } from './queries';

export interface ProposalEmailOutcome {
  emailSent: boolean;
  /** The client has no email on file — a normal state, not a failure. */
  emailSkippedNoAddress: boolean;
}

/** The firm's name in the reader's language, falling back across locales. */
async function loadOrgName(ctx: OrgContext, locale: string): Promise<string> {
  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ nameEn: organizations.nameEn, nameAr: organizations.nameAr })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1),
  );
  const preferred = locale.startsWith('ar')
    ? org?.nameAr || org?.nameEn
    : org?.nameEn || org?.nameAr;
  return preferred ?? 'Metra';
}

/**
 * Tell the client their proposal is ready, and say whether it went.
 *
 * Swallows every failure by design — see the file header. The caller has already
 * committed the send.
 */
export async function notifyClientOfSentProposal(
  ctx: OrgContext,
  input: { proposalId: string; acceptUrl: string; locale: string },
): Promise<ProposalEmailOutcome> {
  try {
    const meta = await getProposalSendMeta(ctx, input.proposalId);
    const clientEmail = meta?.clientEmail?.trim() || null;
    if (!clientEmail) return { emailSent: false, emailSkippedNoAddress: true };
    if (!meta) return { emailSent: false, emailSkippedNoAddress: false };

    const sent = await sendProposalEmail({
      to: clientEmail,
      orgName: await loadOrgName(ctx, input.locale),
      proposalNumber: formatProposalNumber(
        meta.number,
        proposalYear(null, new Date()),
      ),
      totalDisplay: formatMoney(meta.total, input.locale),
      expiryDate: meta.expiryDate,
      acceptUrl: input.acceptUrl,
      locale: input.locale,
    });
    return { emailSent: sent.sent, emailSkippedNoAddress: false };
  } catch (err) {
    console.error(
      'sendProposal email step failed (send unaffected):',
      loggableFailure(err),
    );
    return { emailSent: false, emailSkippedNoAddress: false };
  }
}
