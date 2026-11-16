import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.1: deciding a change order in the home with a code (./code-acts.ts), the
// server's half: ONE statement with exactly its 7 values, and every refusal that
// spends no round trip.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { hashShareToken } from '@/lib/share/token';
import { decideVariationWithCodeByToken } from './code-acts';

const ORDER = '22222222-2222-4222-8222-222222222222';
const DECIDE = { code: '042917', ip: '9.9.9.9', userAgent: 'probe/1', variationId: ORDER, decision: 'approve', name: ' ‮هشام  عادل ' };
const hashOf = (target: string, code: string) => createHash('sha256').update(`decide_variation:${target}:${code}`).digest('hex');

const sentParams = () => {
  const [query] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }];
  return query.queryChunks.filter((chunk) => chunk === null || typeof chunk !== 'object');
};

beforeEach(() => {
  sdf.readSdfJson.mockReset().mockResolvedValue({ code: 'ok' });
});

afterEach(() => vi.restoreAllMocks());

describe('decideVariationWithCodeByToken', () => {
  it.each(['approve', 'reject'])('%s: ONE write with exactly 7 values; the code hash bound to the order, lower-cased, the cleaned name', async (decision) => {
    expect(await decideVariationWithCodeByToken(' tok ', { ...DECIDE, decision, variationId: ORDER.toUpperCase() })).toEqual({ ok: true, already: false });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    expect(sdf.readSdfJson.mock.calls[0][1]).toEqual({ write: true });
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[0][0])).toContain('select public.app_home_variation_respond_by_token(');
    expect(sentParams()).toEqual([hashShareToken('tok'), ORDER, decision, hashOf(ORDER, '042917'), 'هشام عادل', '9.9.9.9', 'probe/1']);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls)).not.toContain('042917');
  });

  it('one code hash for either decision: it is bound to the order, not the decision (OD-7)', async () => {
    await decideVariationWithCodeByToken('tok', { ...DECIDE, decision: 'approve' });
    const approving = sentParams()[3];
    sdf.readSdfJson.mockClear();
    await decideVariationWithCodeByToken('tok', { ...DECIDE, decision: 'reject' });
    expect(sentParams()[3]).toBe(approving);
  });

  it.each<[string, unknown, unknown]>([
    ['already', { code: 'already' }, { ok: true, already: true }],
    ['a wrong code', { code: 'code_wrong', attempts_left: 3 }, { ok: false, error: 'code_wrong', attemptsLeft: 3 }],
    ['code_used', { code: 'code_used' }, { ok: false, error: 'code_used' }],
    ['link_expired', { code: 'link_expired' }, { ok: false, error: 'link_expired' }],
    ['contract_inactive', { code: 'contract_inactive' }, { ok: false, error: 'contract_inactive' }],
    ['wrong_target', { code: 'wrong_target' }, { ok: false, error: 'wrong_target' }],
    ['the wrapper busy', { code: 'busy' }, { ok: false, error: 'busy' }],
    ['the inner not_found', { code: 'not_found' }, { ok: false, error: 'token_invalid' }],
    ['invalid', { code: 'invalid' }, { ok: false, error: 'token_invalid' }],
    ['a code nobody sent', { code: 'surprise' }, { ok: false, error: 'token_invalid' }],
  ])('passes the wrapper answer through: %s', async (_case, payload, answer) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdf.readSdfJson.mockResolvedValue(payload);
    expect(await decideVariationWithCodeByToken('tok', DECIDE)).toEqual(answer);
  });

  it.each(['55P03', '40P01'])('a lock refusal from the database (%s) is busy, never a throw', async (code) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdf.readSdfJson.mockRejectedValue(Object.assign(new Error('lock'), { code }));
    expect(await decideVariationWithCodeByToken('tok', DECIDE)).toEqual({ ok: false, error: 'busy' });
  });

  it.each<[string, Partial<typeof DECIDE> | Record<string, unknown>, unknown]>([
    ['a non-uuid id', { variationId: 'v1' }, { ok: false, error: 'wrong_target' }],
    ['no id', { variationId: null }, { ok: false, error: 'wrong_target' }],
    ['a decision of maybe', { decision: 'maybe' }, { ok: false, error: 'wrong_target' }],
    ['APPROVE', { decision: 'APPROVE' }, { ok: false, error: 'wrong_target' }],
    ['approve with a space', { decision: 'approve ' }, { ok: false, error: 'wrong_target' }],
    ['an array', { decision: ['approve'] }, { ok: false, error: 'wrong_target' }],
    ['a blank name', { name: '   ' }, { ok: false, error: 'name_required' }],
    ['no name', { name: null }, { ok: false, error: 'name_required' }],
    ['an invisible name', { name: '​⁠' }, { ok: false, error: 'name_required' }],
    ['a 10 KB name', { name: 'a'.repeat(10_000) }, { ok: false, error: 'name_required' }],
    ['5 digits', { code: '04291' }, { ok: false, error: 'code_wrong' }],
    ['7 digits', { code: '0429170' }, { ok: false, error: 'code_wrong' }],
    ['no code', { code: null }, { ok: false, error: 'code_wrong' }],
    ['an object for a code', { code: { a: 1 } }, { ok: false, error: 'code_wrong' }],
  ])('%s: refused with no round trip', async (_case, over, answer) => {
    expect(await decideVariationWithCodeByToken('tok', { ...DECIDE, ...over })).toEqual(answer);
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('a blank token is a dead link, with no round trip; Arabic-Indic digits fold to Latin', async () => {
    expect(await decideVariationWithCodeByToken('  ', DECIDE)).toEqual({ ok: false, error: 'token_invalid' });
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
    await decideVariationWithCodeByToken('tok', { ...DECIDE, code: '\u0660\u0664\u0662\u0669\u0661\u0667' });
    expect(sentParams()[3]).toBe(hashOf(ORDER, '042917'));
  });
});
