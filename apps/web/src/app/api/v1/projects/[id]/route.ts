import { isUuid } from '@/lib/api/ids';
import { handleApiRequest, NotFoundError } from '@/lib/api/pipeline';
import { getProjectById } from '@/lib/api/queries';
import { serializeProject } from '@/lib/api/serializers/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApiRequest(req, async ({ ctx }) => {
    const { id } = await params;
    if (!isUuid(id)) throw new NotFoundError();
    const row = await getProjectById(ctx, id);
    if (!row) throw new NotFoundError();
    return serializeProject(row);
  });
}
