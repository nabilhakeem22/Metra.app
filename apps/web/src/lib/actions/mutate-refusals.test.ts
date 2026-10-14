import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { isDefiniteRefusal } from '@/lib/engagements/retry-policy';
import { newFailureReference } from './failure-reference';
import { failFields } from './field-errors';
import { mutateInOrg } from './mutate';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/context', () => ({ withOrgContext: vi.fn() }));

// The named-constraint refusals, the deadlock, the MT100 default and the
// referenced tail of mutateInOrg (C4). The ambiguous family and the log
// whitelist are pinned in mutate-failure.test.ts.

const ctx = { orgId: 'o1', userId: 'u1', role: 'owner' } as unknown as OrgContext;
const openTransaction = vi.mocked(withOrgContext);
type MutateOptions = Parameters<typeof mutateInOrg>[1];

const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

const COST_ITEM_CODE: MutateOptions = {
  refusals: [
    {
      constraint: 'cost_items_org_id_code_unique',
      field: 'code',
      error: { code: 'code_taken' },
    },
    {
      constraint: 'cost_items_default_unit_cost_nonneg',
      field: 'defaultUnitCost',
      error: { code: 'not_negative' },
    },
    { constraint: 'cost_items_section_id_sections_id_fk', field: 'sectionId', error: { code: 'no_longer_exists' } },
  ],
};

function rejectWith(thrown: unknown, opts: MutateOptions = {}) {
  openTransaction.mockRejectedValueOnce(thrown);
  return mutateInOrg(ctx, opts, async () => undefined);
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openTransaction.mockReset();
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe('a constraint the caller named', () => {
  it('answers a 23505 with the field error it was given, silently (AC 1)', async () => {
    await expect(
      rejectWith({ code: '23505', constraint_name: 'cost_items_org_id_code_unique' }, COST_ITEM_CODE),
    ).resolves.toEqual({ ok: false, error: 'check_fields', fields: { code: { code: 'code_taken' } } });
    expect(logged).not.toHaveBeenCalled();
  });

  it('answers a 23514 and a 23503 the same way (AC 2)', async () => {
    await expect(
      rejectWith({ code: '23514', constraint_name: 'cost_items_default_unit_cost_nonneg' }, COST_ITEM_CODE),
    ).resolves.toEqual({
      ok: false,
      error: 'check_fields',
      fields: { defaultUnitCost: { code: 'not_negative' } },
    });
    await expect(
      rejectWith({ code: '23503', constraint_name: 'cost_items_section_id_sections_id_fk' }, COST_ITEM_CODE),
    ).resolves.toEqual({
      ok: false,
      error: 'check_fields',
      fields: { sectionId: { code: 'no_longer_exists' } },
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it.each(['23505', '23514', '23503'])(
    'leaves an UNLISTED %s in the tail: generic, a reference, one whitelisted log line (AC 3)',
    async (code) => {
      const result = await rejectWith(
        Object.assign(new Error('Failed query: insert ... params: 0100'), {
          query: 'insert into cost_items ...',
          params: ['org', '0100'],
          cause: { code, constraint_name: 'cost_items_other', detail: 'Key (code)=(X1) exists.' },
        }),
        COST_ITEM_CODE,
      );
      expect(result).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
      expect(logged).toHaveBeenCalledOnce();
      const [label, payload] = logged.mock.calls[0] as [string, { reference: string; failure: object }];
      expect(label).toBe('mutateInOrg failed');
      expect(payload.reference).toBe(result.reference);
      const printed = JSON.stringify(payload);
      for (const leak of ['detail', 'params', 'query', 'X1', '0100']) expect(printed).not.toContain(leak);
    },
  );
});

describe('the other SQLSTATE answers', () => {
  it('answers a deadlock busy, logs nothing, and busy holds the key (AC 4)', async () => {
    await expect(rejectWith({ code: '40P01' })).resolves.toEqual({ ok: false, error: 'busy' });
    expect(logged).not.toHaveBeenCalled();
    expect(isDefiniteRefusal('busy')).toBe(false);
  });

  it.each(['55P03', '57014', '57P01', '08006', 'ECONNRESET'])(
    'keeps %s uncertain, ahead of any refusal (AC 5)',
    async (code) => {
      await expect(rejectWith({ code, constraint_name: 'cost_items_org_id_code_unique' }, COST_ITEM_CODE))
        .resolves.toEqual({ ok: false, error: 'uncertain' });
    },
  );

  it('answers an MT100 immutable by default, and the given code when named (AC 6)', async () => {
    await expect(rejectWith({ code: 'MT100' })).resolves.toEqual({ ok: false, error: 'immutable' });
    await expect(rejectWith({ code: 'MT100' }, { immutableCode: 'contract_not_draft' })).resolves.toEqual({
      ok: false,
      error: 'contract_not_draft',
    });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('field errors raised inside the mutation', () => {
  it('returns the fields failFields threw, silently (AC 7)', async () => {
    openTransaction.mockImplementationOnce(async (_ctx, run) => run({} as never));
    await expect(
      mutateInOrg(ctx, {}, async () => failFields({ phone: { code: 'phone_required' } })),
    ).resolves.toEqual({ ok: false, error: 'check_fields', fields: { phone: { code: 'phone_required' } } });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('newFailureReference', () => {
  it('is fresh each time and always 8 Crockford characters (AC 8)', () => {
    const first = newFailureReference();
    const second = newFailureReference();
    expect(first).toMatch(REFERENCE);
    expect(second).toMatch(REFERENCE);
    expect(first).not.toBe(second);
  });
});
