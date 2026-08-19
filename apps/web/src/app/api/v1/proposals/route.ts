import { handleApiRequest } from '@/lib/api/pipeline';
import { buildPage, parsePageParams } from '@/lib/api/pagination';
import { listProposalsPage } from '@/lib/api/queries';
import { serializeProposalSummary } from '@/lib/api/serializers/proposal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return handleApiRequest(req, async ({ ctx, url }) => {
    const page = parsePageParams(url);
    const rows = await listProposalsPage(ctx, page);
    const { items, nextCursor } = buildPage(rows, page.limit);
    return {
      data: items.map(serializeProposalSummary),
      next_cursor: nextCursor,
    };
  });
}
