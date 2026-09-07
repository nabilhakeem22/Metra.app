import { buildTemplateCsv, templateFilename } from '@/lib/boqs/import/template';
import { requireOrg } from '@/lib/auth/require-org';
import { listCostItems } from '@/lib/price-book/queries';

/**
 * Serve the BOQ template as a download.
 *
 * Behind requireOrg: the template is not secret, but an unauthenticated endpoint
 * that runs org resolution is a surface with no reason to exist.
 *
 * text/csv with an explicit charset, and `attachment` so the browser saves it
 * rather than rendering it as text — which is what Chrome does with a CSV it is
 * allowed to display inline.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await requireOrg();
  const projectCode = new URL(request.url).searchParams.get('project');

  // The template carries the studio's ACTIVE price book: code, description,
  // unit and both rates, with the quantity column blank. That turns pricing a
  // project into typing quantities against rates already agreed, and it is what
  // gives an imported line a cost basis — a hand-typed rate has a price and no
  // cost, so margin and budget tracking have nothing to work from later.
  const items = await listCostItems(ctx, { active: true });

  return new Response(
    buildTemplateCsv({
      items: items.map((i) => ({
        code: i.code,
        description: i.nameEn ?? i.nameAr ?? i.code,
        unit: i.unit,
        unitPrice: i.defaultUnitPrice,
        unitCost: i.defaultUnitCost,
      })),
    }),
    {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${templateFilename(projectCode)}"`,
      'cache-control': 'no-store',
      },
    },
  );
}
