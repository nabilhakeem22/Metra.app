import { handleApiRequest } from '@/lib/api/pipeline';
import { buildPage, parsePageParams } from '@/lib/api/pagination';
import { listProjectsPage } from '@/lib/api/queries';
import { serializeProject } from '@/lib/api/serializers/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return handleApiRequest(req, async ({ ctx, url }) => {
    const page = parsePageParams(url);
    const rows = await listProjectsPage(ctx, page);
    const { items, nextCursor } = buildPage(rows, page.limit);
    return { data: items.map(serializeProject), next_cursor: nextCursor };
  });
}
