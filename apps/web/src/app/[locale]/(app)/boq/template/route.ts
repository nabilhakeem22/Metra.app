import type { CostItem } from '@metra/db';
import { NextResponse } from 'next/server';
import { buildTemplateCsv, templateFilename, type TemplateItem } from '@/lib/boqs/import/template';
import { requireOrg } from '@/lib/auth/require-org';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { byName } from '@/lib/price-book/name-order';
import { listCostItems } from '@/lib/price-book/queries';

/**
 * Serve the BOQ template as a download.
 *
 * Gated like the import it feeds (S1, go-live security): only a member who may
 * create a BOQ gets it, and the check runs BEFORE any read. The template carries
 * the price book, and a unit cost next to its price is the studio's margin, so
 * the cost column is blank for anyone who may not see margin (a PM in a studio
 * that hides margin from PMs).
 *
 * text/csv with an explicit charset, and `attachment` so the browser saves it
 * rather than rendering it as text — which is what Chrome does with a CSV it is
 * allowed to display inline.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'boq_build', 'create')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  const projectCode = new URL(request.url).searchParams.get('project');
  const seesMargin = await resolveSeeMargin(ctx);

  // The template carries the studio's ACTIVE price book: code, description,
  // unit and both rates, with the quantity column blank. That turns pricing a
  // project into typing quantities against rates already agreed, and it is what
  // gives an imported line a cost basis — a hand-typed rate has a price and no
  // cost, so margin and budget tracking have nothing to work from later.
  // Ordered by name, as the description column reads (English first): with a
  // seeded book of 450+ items, code order put every MKT- row before the
  // studio's own.
  const items = (await listCostItems(ctx, { active: true })).sort(byName('en'));

  return new Response(buildTemplateCsv({ items: items.map((item) => templateItemFor(item, seesMargin)) }), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${templateFilename(projectCode)}"`,
      'cache-control': 'no-store',
    },
  });
}

/** One price-book item as a template row; the unit cost only for a caller who may see margin. */
function templateItemFor(item: CostItem, seesMargin: boolean): TemplateItem {
  return {
    code: item.code,
    description: item.nameEn ?? item.nameAr ?? item.code,
    unit: item.unit,
    unitPrice: item.defaultUnitPrice,
    unitCost: seesMargin ? item.defaultUnitCost : '',
  };
}
