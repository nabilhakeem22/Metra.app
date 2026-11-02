import { describe, expect, it, vi } from 'vitest';

// S7 (go-live security): a client's proposal acceptance and variation approval
// record the IP Cloudflare saw (cf-connecting-ip), never the first
// x-forwarded-for hop, which the client writes itself. The real
// requestProvenance runs; the request headers and the writes are replaced.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'user-agent': 'probe/1' }),
}));
const respond = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/proposals/public', () => ({ respondToProposalByToken: respond }));
vi.mock('@/lib/variations/public', () => ({ respondToVariationByToken: respond }));

const { respondToProposal } = await import('./p/[token]/actions');
const { respondToVariation } = await import('./v/[token]/actions');

function recordedProvenance() {
  const [, input] = respond.mock.lastCall as unknown as [string, { ip: unknown; userAgent: unknown }];
  return { ip: input.ip, userAgent: input.userAgent };
}

describe('the provenance a client-link decision records', () => {
  it('a /p accept records the edge IP, not the forged hop', async () => {
    await respondToProposal('tok', 'accept', 'Mona');
    expect(recordedProvenance()).toEqual({ ip: '203.0.113.9', userAgent: 'probe/1' });
  });

  it('a /v approval records the edge IP, not the forged hop', async () => {
    await respondToVariation('tok', 'approve', 'Mona');
    expect(recordedProvenance()).toEqual({ ip: '203.0.113.9', userAgent: 'probe/1' });
  });
});
