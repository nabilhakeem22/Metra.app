import { isUuid } from '@/lib/api/ids';
import { handleApiRequest, NotFoundError } from '@/lib/api/pipeline';
import { serializeProposal } from '@/lib/api/serializers/proposal';
import { getProposalWithLines } from '@/lib/proposals/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApiRequest(req, async ({ ctx, costVisible }) => {
    const { id } = await params;
    if (!isUuid(id)) throw new NotFoundError();
    // The query strips cost/margin when the key's live role can't see margin.
    const detail = await getProposalWithLines(ctx, id, costVisible);
    if (!detail) throw new NotFoundError();
    return serializeProposal(detail, costVisible);
  });
}
