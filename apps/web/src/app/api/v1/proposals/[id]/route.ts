import { handleApiRequest, NotFoundError } from '@/lib/api/pipeline';
import { serializeProposal } from '@/lib/api/serializers/proposal';
import { getProposalWithLines } from '@/lib/proposals/queries';
import { isUuid } from '@/lib/uuid';

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
    // Public API v1's proposals are quotes: a delivery's BOQ working copy is
    // not one, so it does not exist here.
    if (!detail || detail.kind === 'boq') throw new NotFoundError();
    return serializeProposal(detail, costVisible);
  }, { capability: 'proposals_build', action: 'read' });
}
