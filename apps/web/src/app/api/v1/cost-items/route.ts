import { handleApiRequest } from '@/lib/api/pipeline';
import { buildPage, parsePageParams } from '@/lib/api/pagination';
import { listCostItemsPage } from '@/lib/api/queries';
import { serializeCostItem } from '@/lib/api/serializers/cost-item';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return handleApiRequest(req, async ({ ctx, url, costVisible }) => {
    const page = parsePageParams(url);
    const rows = await listCostItemsPage(ctx, page);
    const { items, nextCursor } = buildPage(rows, page.limit);
    return {
      data: items.map((row) => serializeCostItem(row, costVisible)),
      next_cursor: nextCursor,
    };
  });
}
