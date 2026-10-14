import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BoqIssue } from './boq-issue';

// F3: Issue says the cause of every refusal, an unknown failure's reference,
// and a request that never answered, in both locales; never one blanket line.

const boqs = vi.hoisted(() => ({ issueBoq: vi.fn() }));
vi.mock('@/lib/boqs/actions', () => boqs);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => toasts);
vi.mock('@/hooks/pending-removals', () => ({ flushPendingRemovals: async () => true }));

beforeEach(() => {
  boqs.issueBoq.mockReset();
  toasts.toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('BOQ Issue refused (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  async function issue() {
    renderWithIntl(<BoqIssue boqId="b-1" disabled={false} clientCanOpen />, { locale });
    fireEvent.click(screen.getByRole('button', { name: at('projects.profile.boq.issue') }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: at('projects.profile.boq.issueConfirm') }));
    });
  }
  const said = () => toasts.toast.mock.calls.at(-1)?.[0];

  test.each(['line_required', 'forbidden', 'boq_not_draft', 'busy', 'uncertain', 'renderer_busy'])(
    '%s says its own sentence',
    async (code) => {
      boqs.issueBoq.mockResolvedValue({ ok: false, error: code });
      await issue();
      expect(said()).toEqual({ title: at(`errors.${code}`), variant: 'destructive' });
    },
  );

  test('an unknown failure hands over its reference', async () => {
    boqs.issueBoq.mockResolvedValue({ ok: false, error: 'generic', reference: 'K7Q29MXD' });
    await issue();
    expect(said()?.title).toBe(`${at('errors.generic')} ${at('errors.reference').replace('{reference}', 'K7Q29MXD')}`);
  });

  test('no engagement to deliver through keeps its own sentence', async () => {
    boqs.issueBoq.mockResolvedValue({ ok: false, error: 'engagement_not_found' });
    await issue();
    expect(said()?.title).toBe(at('projects.profile.boq.issueNoEngagement'));
  });

  test('a request that never answered says Metra could not be reached', async () => {
    boqs.issueBoq.mockRejectedValue(new TypeError('Failed to fetch'));
    await issue();
    expect(said()).toEqual({ title: at('errors.unreachable'), variant: 'destructive' });
  });
});
