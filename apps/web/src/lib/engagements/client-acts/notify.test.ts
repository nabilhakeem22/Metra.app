// notifyStudioOfClientAct: the SDF call is built from the server-side act map,
// a missing or malformed answer is "not notified" with no email, and only the
// NEW recipients are emailed, from after(), never awaited by the action.
import type { SQL } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const readSdfJson = vi.fn<(query: SQL) => Promise<unknown>>();
vi.mock('@/lib/share/sdf-call', () => ({
  normalizeRawToken: (raw: string | null | undefined) => raw?.trim() || null,
  readSdfJson: (query: SQL) => readSdfJson(query),
}));

const after = vi.fn<(task: () => unknown) => void>();
vi.mock('next/server', () => ({ after: (task: () => unknown) => after(task) }));

const resolveRequestOrigin = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/http/request-origin', () => ({
  resolveRequestOrigin: () => resolveRequestOrigin(),
}));

vi.mock('@/i18n/routing', () => ({ LOCALES: ['ar-EG', 'en'] }));

const deliveryLabelForEmail = vi.fn<() => Promise<string>>();
vi.mock('./delivery-label', () => ({
  deliveryLabelForEmail: () => deliveryLabelForEmail(),
}));

const emailClientActRecipients = vi.fn<(batch: unknown) => Promise<void>>();
vi.mock('./email', () => ({
  emailClientActRecipients: (batch: unknown) => emailClientActRecipients(batch),
}));

import { hashShareToken } from '@/lib/share/token';
import { NOTIFY_BUDGET_MS, notifyStudioOfClientAct, withStudioNotified } from './notify';
import { parseStudioNotified } from './studio-notified';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

/** The values drizzle binds for a built `sql` template, in order. */
function boundValues(query: SQL): unknown[] {
  const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
  return chunks.filter(
    (chunk) => !(chunk && typeof chunk === 'object' && 'value' in chunk && Array.isArray(chunk.value)),
  );
}

beforeEach(() => {
  readSdfJson.mockReset();
  after.mockReset();
  resolveRequestOrigin.mockReset().mockResolvedValue('https://metra.app');
  deliveryLabelForEmail.mockReset().mockResolvedValue('DE-2026-0012 · Villa');
  emailClientActRecipients.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('notifyStudioOfClientAct', () => {
  it('calls the notifier with the hash, and the key, params and roles of the act', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'en',
      notified_count: 2,
      new_recipients: [],
    });
    await notifyStudioOfClientAct(' raw-token ', { kind: 'payment_claimed', milestoneKind: 'gate_a' });

    const [query] = readSdfJson.mock.calls[0];
    expect(boundValues(query)).toEqual([
      hashShareToken('raw-token'),
      'client_payment_claimed',
      '{"milestoneKind":"gate_a"}',
      '["owner","admin","accountant"]',
    ]);
  });

  it('a repeat that only bumped rows is notified, and emails nobody', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'ar-EG',
      notified_count: 3,
      new_recipients: [],
    });
    expect(await notifyStudioOfClientAct('raw', { kind: 'design_approved' })).toEqual({
      studioNotified: true,
    });
    expect(emailClientActRecipients).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('a null answer (dead link, bad input) is not notified and sends no email', async () => {
    readSdfJson.mockResolvedValue(null);
    expect(await notifyStudioOfClientAct('raw', { kind: 'commented' })).toEqual({
      studioNotified: false,
    });
    expect(emailClientActRecipients).not.toHaveBeenCalled();
  });

  it('nobody to notify (no member holds the roles) is not "notified"', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'en',
      notified_count: 0,
      new_recipients: [],
    });
    expect(await notifyStudioOfClientAct('raw', { kind: 'commented' })).toEqual({
      studioNotified: false,
    });
  });

  it('a blank token never reaches the database', async () => {
    expect(await notifyStudioOfClientAct('   ', { kind: 'commented' })).toEqual({
      studioNotified: false,
    });
    expect(readSdfJson).not.toHaveBeenCalled();
  });

  it('a throwing SDF is one log line and "not notified", never a throw', async () => {
    readSdfJson.mockRejectedValue(new Error('connection reset'));
    expect(await notifyStudioOfClientAct('raw', { kind: 'design_approved' })).toEqual({
      studioNotified: false,
    });
    expect(console.error).toHaveBeenCalledWith('client act notify failed:', {
      act: 'client_design_approved',
      error: expect.anything(),
    });
  });

  it('starts the emails for the NEW recipients at once and hands them to after()', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'en',
      notified_count: 2,
      new_recipients: [OWNER, ADMIN],
    });
    let finish: () => void = () => {};
    emailClientActRecipients.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));

    // The action resolves while the emails are still in flight.
    expect(await notifyStudioOfClientAct('raw', { kind: 'design_approved' })).toEqual({
      studioNotified: true,
    });
    expect(emailClientActRecipients).toHaveBeenCalledWith({
      userIds: [OWNER, ADMIN],
      act: { kind: 'design_approved' },
      deliveryLabel: 'DE-2026-0012 · Villa',
      deliveryUrl: `https://metra.app/en/engagements/${ENGAGEMENT}`,
      locale: 'en',
    });
    expect(after).toHaveBeenCalledTimes(1);
    finish();
  });

  it('no app origin: still notified in-app, no email, one log line', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'en',
      notified_count: 1,
      new_recipients: [OWNER],
    });
    resolveRequestOrigin.mockResolvedValue(null);
    expect(await notifyStudioOfClientAct('raw', { kind: 'design_approved' })).toEqual({
      studioNotified: true,
    });
    expect(emailClientActRecipients).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('client act email skipped: no app origin');
  });

  it('an after() that is unavailable does not undo the notification', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'en',
      notified_count: 1,
      new_recipients: [OWNER],
    });
    after.mockImplementation(() => {
      throw new Error('after() outside a request');
    });
    expect(await notifyStudioOfClientAct('raw', { kind: 'design_approved' })).toEqual({
      studioNotified: true,
    });
    expect(emailClientActRecipients).toHaveBeenCalledTimes(1);
  });
});

describe('the client never waits more than NOTIFY_BUDGET_MS (R2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a hung notifier answers "not notified" at the budget', async () => {
    vi.useFakeTimers();
    readSdfJson.mockReturnValue(new Promise(() => {}));
    const pending = notifyStudioOfClientAct('raw', { kind: 'design_approved' });
    await vi.advanceTimersByTimeAsync(NOTIFY_BUDGET_MS);
    expect(await pending).toEqual({ studioNotified: false });
    expect(NOTIFY_BUDGET_MS).toBe(2_000);
    expect(console.error).toHaveBeenCalledWith('client act notify failed:', {
      act: 'client_design_approved',
      error: expect.objectContaining({ name: 'HttpDeadlineError' }),
    });
  });

  it('a hung label read is cut at what is left of the budget; the email still goes, unlabelled', async () => {
    vi.useFakeTimers();
    readSdfJson.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                engagement_id: ENGAGEMENT,
                locale: 'en',
                notified_count: 1,
                new_recipients: [OWNER],
              }),
            500,
          ),
        ),
    );
    deliveryLabelForEmail.mockReturnValue(new Promise(() => {}));
    const pending = notifyStudioOfClientAct('raw', { kind: 'design_approved' });
    await vi.advanceTimersByTimeAsync(NOTIFY_BUDGET_MS);
    expect(await pending).toEqual({ studioNotified: true });
    expect(emailClientActRecipients).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryLabel: '', userIds: [OWNER] }),
    );
  });

  it('with no budget left, the label is not even read', async () => {
    vi.useFakeTimers();
    readSdfJson.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                engagement_id: ENGAGEMENT,
                locale: 'en',
                notified_count: 1,
                new_recipients: [OWNER],
              }),
            NOTIFY_BUDGET_MS - 50,
          ),
        ),
    );
    const pending = notifyStudioOfClientAct('raw', { kind: 'design_approved' });
    await vi.advanceTimersByTimeAsync(NOTIFY_BUDGET_MS);
    expect(await pending).toEqual({ studioNotified: true });
    expect(deliveryLabelForEmail).not.toHaveBeenCalled();
    expect(emailClientActRecipients).toHaveBeenCalledWith(expect.objectContaining({ deliveryLabel: '' }));
  });
});

describe('R6: a notifier that wrote nothing says so, naming the act', () => {
  it('logs the act key and nothing else', async () => {
    readSdfJson.mockResolvedValue(null);
    await notifyStudioOfClientAct('raw-secret-token', { kind: 'payment_claimed', milestoneKind: 'deposit' });
    expect(console.warn).toHaveBeenCalledWith('client act notify wrote nothing:', {
      act: 'client_payment_claimed',
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('raw-secret-token');
  });
});

describe('withStudioNotified', () => {
  it('an `already` repeat never calls the notifier', async () => {
    expect(
      await withStudioNotified('raw', { ok: true, code: 'already' as const }, { kind: 'design_approved' }),
    ).toEqual({ ok: true, code: 'already', studioNotified: false });
    expect(readSdfJson).not.toHaveBeenCalled();
  });

  it('a refusal never calls the notifier', async () => {
    expect(
      await withStudioNotified('raw', { ok: false, error: 'wrong_state' as const }, { kind: 'commented' }),
    ).toEqual({ ok: false, error: 'wrong_state', studioNotified: false });
    expect(readSdfJson).not.toHaveBeenCalled();
  });

  it('a first ok carries what the notifier answered', async () => {
    readSdfJson.mockResolvedValue({
      engagement_id: ENGAGEMENT,
      locale: 'en',
      notified_count: 1,
      new_recipients: [],
    });
    expect(await withStudioNotified('raw', { ok: true }, { kind: 'commented' })).toEqual({
      ok: true,
      studioNotified: true,
    });
  });

  it('an ok with no act is not notified', async () => {
    expect(await withStudioNotified('raw', { ok: true }, null)).toEqual({
      ok: true,
      studioNotified: false,
    });
    expect(readSdfJson).not.toHaveBeenCalled();
  });
});

describe('parseStudioNotified', () => {
  it.each([
    null,
    'x',
    { engagement_id: 'not-a-uuid', notified_count: 1, new_recipients: [] },
    { engagement_id: ENGAGEMENT, notified_count: '1', new_recipients: [] },
    { engagement_id: ENGAGEMENT, notified_count: 1, new_recipients: null },
  ])('refuses %j', (data) => {
    expect(parseStudioNotified(data)).toBeNull();
  });

  it('drops non-uuid recipients and defaults an unknown locale to ar-EG', () => {
    expect(
      parseStudioNotified({
        engagement_id: ENGAGEMENT,
        locale: 'fr',
        notified_count: 1,
        new_recipients: [OWNER, 7, 'nope'],
      }),
    ).toEqual({ engagementId: ENGAGEMENT, locale: 'ar-EG', notifiedCount: 1, newRecipients: [OWNER] });
  });
});
