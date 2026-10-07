// The autosave wrapper is the save WITHOUT the app refresh: a pause in typing must
// not re-render the builder from the server. The explicit save still refreshes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshApp = vi.hoisted(() => vi.fn());
const saveProposalDraftCore = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/refresh', () => ({ refreshApp }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: vi.fn().mockResolvedValue({ orgId: 'o-1' }) }));
vi.mock('./core', () => ({ saveProposalDraftCore }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn() }));
vi.mock('@/lib/http/request-origin', () => ({ resolveRequestOrigin: vi.fn() }));
vi.mock('./preview-html', () => ({ renderProposalPreviewHtml: vi.fn() }));
vi.mock('./send-email', () => ({ notifyClientOfSentProposal: vi.fn() }));

const { autosaveProposalDraft, saveProposalDraft } = await import('./actions');

const input = { id: 'p-1', sections: [] };

beforeEach(() => {
  vi.clearAllMocks();
  saveProposalDraftCore.mockResolvedValue({ ok: true });
});

describe('autosaveProposalDraft', () => {
  it('saves through saveProposalDraftCore and never refreshes the app', async () => {
    await expect(autosaveProposalDraft(input)).resolves.toEqual({ ok: true, error: undefined });
    expect(saveProposalDraftCore).toHaveBeenCalledWith({ orgId: 'o-1' }, input);
    expect(refreshApp).not.toHaveBeenCalled();
  });

  it('passes a refusal through unchanged', async () => {
    saveProposalDraftCore.mockResolvedValue({ ok: false, error: 'line_required' });
    await expect(autosaveProposalDraft(input)).resolves.toEqual({ ok: false, error: 'line_required' });
  });

  it('the explicit save still refreshes once', async () => {
    await saveProposalDraft(input);
    expect(refreshApp).toHaveBeenCalledTimes(1);
  });
});
