import { handleApiRequest } from '@/lib/api/pipeline';
import { buildPage, parsePageParams } from '@/lib/api/pagination';
import { listClientsPage } from '@/lib/api/queries';
import { serializeClient } from '@/lib/api/serializers/client';

// Node runtime (mirrors the PDF/cron routes): postgres.js + node:crypto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return handleApiRequest(req, async ({ ctx, url }) => {
    const page = parsePageParams(url);
    const rows = await listClientsPage(ctx, page);
    const { items, nextCursor } = buildPage(rows, page.limit);
    return { data: items.map(serializeClient), next_cursor: nextCursor };
  });
}
