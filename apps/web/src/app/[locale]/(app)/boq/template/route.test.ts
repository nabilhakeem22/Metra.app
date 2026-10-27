import { beforeEach, describe, expect, it, vi } from 'vitest';

// S1 (go-live security): the BOQ template carries the price book, so only a
// member who may build a BOQ gets it, and the unit cost only reaches one who
// may see margin. The real gate and the real resolveSeeMargin run; auth, the
// org row and the price book are replaced.

vi.mock('server-only', () => ({}));
const auth = vi.hoisted(() => ({ requireOrg: vi.fn() }));
vi.mock('@/lib/auth/require-org', () => auth);
const orgRow = vi.hoisted(() => ({ hide: false }));
vi.mock('@/lib/db/context', () => ({ withOrgContext: async () => [{ hide: orgRow.hide }] }));
const priceBook = vi.hoisted(() => ({ listCostItems: vi.fn() }));
vi.mock('@/lib/price-book/queries', () => priceBook);

const { GET } = await import('./route');

const UNIT_COST = '777.1234';
const ITEM = {
  code: 'GY-01',
  nameEn: 'Gypsum ceiling',
  nameAr: null,
  unit: 'sqm',
  defaultUnitPrice: '1500.0000',
  defaultUnitCost: UNIT_COST,
};

function signedInAs(role: string) {
  auth.requireOrg.mockResolvedValue({ orgId: 'o1', userId: 'u1', userEmail: 'a@b.c', role });
}

async function download(): Promise<Response> {
  return GET(new Request('https://app.metra.test/en/boq/template?project=P-1'));
}

/** The CSV rows as cells (the fixture has no quoted cell). */
async function rowsOf(response: Response): Promise<string[][]> {
  return (await response.text()).replace(/^﻿/, '').trim().split('\r\n').map((line) => line.split(','));
}

beforeEach(() => {
  orgRow.hide = false;
  priceBook.listCostItems.mockReset().mockResolvedValue([ITEM]);
});

describe('GET /[locale]/boq/template', () => {
  it.each(['site_engineer', 'accountant', 'viewer'])('refuses a %s before reading anything', async (role) => {
    signedInAs(role);
    const response = await download();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(priceBook.listCostItems).not.toHaveBeenCalled();
  });

  it('gives an owner the costs', async () => {
    signedInAs('owner');
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const [header, item] = await rowsOf(response);
    expect(item[header.indexOf('Unit cost')]).toBe(UNIT_COST);
  });

  it('blanks the cost for a PM when the studio hides margin from PMs', async () => {
    signedInAs('project_manager');
    orgRow.hide = true;
    const response = await download();
    expect(response.status).toBe(200);
    const body = await response.clone().text();
    const [header, item] = await rowsOf(response);
    expect(header).toEqual(['Item', 'Section', 'Description', 'Unit', 'Qty', 'Unit price', 'Unit cost', 'Provisional', 'Price book']);
    expect(item[header.indexOf('Unit cost')]).toBe('');
    expect(item[header.indexOf('Unit price')]).toBe('1500.0000');
    expect(body).not.toContain(UNIT_COST);
  });

  it('gives a PM the costs when the studio shows margin to PMs', async () => {
    signedInAs('project_manager');
    const [header, item] = await rowsOf(await download());
    expect(item[header.indexOf('Unit cost')]).toBe(UNIT_COST);
  });
});
