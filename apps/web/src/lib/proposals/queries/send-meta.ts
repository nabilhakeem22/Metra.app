import 'server-only';
import { clients, proposals } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ProposalSendMeta {
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  total: string;
  expiryDate: string | null;
  clientEmail: string | null;
}

/**
 * The minimal, NON-cost fields the send-email needs: number/title/total/expiry
 * and the client's stored email. Never returns cost or margin.
 */
export async function getProposalSendMeta(
  ctx: OrgContext,
  id: string,
): Promise<ProposalSendMeta | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        number: proposals.number,
        titleAr: proposals.titleAr,
        titleEn: proposals.titleEn,
        total: proposals.total,
        expiryDate: proposals.expiryDate,
        clientEmail: clients.email,
      })
      .from(proposals)
      .leftJoin(clients, eq(clients.id, proposals.clientId))
      .where(eq(proposals.id, id))
      .limit(1);
    return row ?? null;
  });
}
