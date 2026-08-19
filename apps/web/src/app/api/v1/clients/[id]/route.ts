import { isUuid } from '@/lib/api/ids';
import { handleApiRequest, NotFoundError } from '@/lib/api/pipeline';
import { getClientById } from '@/lib/api/queries';
import { serializeClient } from '@/lib/api/serializers/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApiRequest(req, async ({ ctx }) => {
    const { id } = await params;
    if (!isUuid(id)) throw new NotFoundError();
    const row = await getClientById(ctx, id);
    if (!row) throw new NotFoundError();
    return serializeClient(row);
  });
}
