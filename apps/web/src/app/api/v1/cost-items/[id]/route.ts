import { handleApiRequest, NotFoundError } from '@/lib/api/pipeline';
import { getCostItemById } from '@/lib/api/queries';
import { serializeCostItem } from '@/lib/api/serializers/cost-item';
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
    const row = await getCostItemById(ctx, id);
    if (!row) throw new NotFoundError();
    return serializeCostItem(row, costVisible);
  });
}
