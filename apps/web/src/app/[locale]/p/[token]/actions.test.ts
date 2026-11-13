import { beforeEach, describe, expect, test, vi } from 'vitest';

// P4a: the client's accept or reject on /p spends the link's ACT budget
// (lib/share/portal-rate-limit.ts) before anything else. Past it the answer is
// `too_many`, nothing is sent to the database's response function, and the
// page keeps the decision open. Within it the act is sent exactly as before.

vi.mock('server-only', () => ({}));
const budget = vi.hoisted(() => ({ actAllowed: vi.fn(async () => true) }));
const proposal = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalActAllowed: budget.actAllowed }));
vi.mock('@/lib/proposals/public', () => ({ respondToProposalByToken: proposal.respond }));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '10.0.0.1', userAgent: 'ua' }) }));

const { respondToProposal } = await import('./actions');

beforeEach(() => {
  budget.actAllowed.mockReset().mockResolvedValue(true);
  proposal.respond.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('respondToProposal: the link act budget (P4a)', () => {
  test.each(['accept', 'reject'] as const)('past the budget a %s answers too_many, and nothing is sent', async (decision) => {
    budget.actAllowed.mockResolvedValue(false);
    expect(await respondToProposal('t', decision, 'Client')).toEqual({ ok: false, error: 'too_many' });
    expect(budget.actAllowed).toHaveBeenCalledWith('t');
    expect(proposal.respond).not.toHaveBeenCalled();
  });

  test('within the budget the act is charged once, then sent as before', async () => {
    expect(await respondToProposal('t', 'accept', ' Client ')).toEqual({ ok: true });
    expect(budget.actAllowed).toHaveBeenCalledTimes(1);
    expect(budget.actAllowed).toHaveBeenCalledWith('t');
    expect(proposal.respond).toHaveBeenCalledTimes(1);
    expect(proposal.respond).toHaveBeenCalledWith('t', { decision: 'accept', actorName: 'Client', ip: '10.0.0.1', userAgent: 'ua' });
  });

  test('within the budget a refusal from the database is answered as before', async () => {
    proposal.respond.mockResolvedValue({ ok: false, error: 'token_expired' });
    expect(await respondToProposal('t', 'reject')).toEqual({ ok: false, error: 'token_expired' });
    expect(proposal.respond).toHaveBeenCalledWith('t', { decision: 'reject', actorName: null, ip: '10.0.0.1', userAgent: 'ua' });
  });

  test('a limiter that rejects (its binding missing on Cloudflare) is the referenced generic, and nothing is sent', async () => {
    budget.actAllowed.mockRejectedValue(new Error('Rate limiting binding PORTAL_ACT_RATE_LIMITER is missing'));
    expect(await respondToProposal('t', 'accept', 'Client')).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(proposal.respond).not.toHaveBeenCalled();
  });
});
