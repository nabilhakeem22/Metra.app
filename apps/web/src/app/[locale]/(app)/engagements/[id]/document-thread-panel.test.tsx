import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { DocumentThreadPanel } from './document-thread-panel';

// Round D second fix round (F3): on the STUDIO side, a reply that was saved but
// whose re-read failed stays on screen with a "some may be missing" notice (it
// used to vanish behind "No messages on this file yet"); a read that fails says
// so, to a viewer without reply rights too.

const actions = vi.hoisted(() => ({ listDocumentComments: vi.fn(), replyToDocument: vi.fn() }));
vi.mock('@/lib/engagements/actions/deliverables', () => actions);

const ARTIFACT = '22222222-2222-4222-8222-222222222222';
const CLIENT_MESSAGES = [1, 2].map((index) => ({
  id: `client-${index}`,
  channel: 'client',
  authorUserId: null,
  authorName: 'Mona',
  body: `Client question ${index}`,
  createdAt: new Date(`2026-10-0${index}T10:00:00Z`),
}));
const en = (path: string) => messageAt('en', path);

function open(canReply = true) {
  renderWithIntl(<DocumentThreadPanel artifactId={ARTIFACT} canReply={canReply} />, { locale: 'en' });
  fireEvent.click(screen.getByRole('button', { name: en('engagements.comments.open') }));
}

async function reply(body: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: body } });
  fireEvent.click(screen.getByRole('button', { name: en('engagements.comments.reply') }));
  await waitFor(() => expect(actions.listDocumentComments).toHaveBeenCalledTimes(2));
}

beforeEach(() => {
  actions.listDocumentComments.mockReset();
  actions.replyToDocument.mockReset().mockResolvedValue({ ok: true });
});

describe('DocumentThreadPanel when a read fails', () => {
  it('a saved reply whose re-read fails stays visible beside the client messages, with the notice', async () => {
    actions.listDocumentComments.mockResolvedValueOnce(CLIENT_MESSAGES).mockRejectedValue(new Error('network'));
    open();
    await screen.findByText('Client question 1');
    await reply('Yes, it is oak.');
    expect(await screen.findByText('Yes, it is oak.')).toBeTruthy();
    expect(screen.getByText('Client question 2')).toBeTruthy();
    expect(screen.getByText(en('engagements.comments.partial'))).toBeTruthy();
    expect(screen.queryByText(en('engagements.comments.empty'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('an empty thread: the saved reply shows instead of "No messages on this file yet"', async () => {
    actions.listDocumentComments.mockResolvedValueOnce([]).mockRejectedValue(new Error('network'));
    open();
    await screen.findByText(en('engagements.comments.empty'));
    await reply('Hello from the studio');
    expect(await screen.findByText('Hello from the studio')).toBeTruthy();
    expect(screen.queryByText(en('engagements.comments.empty'))).toBeNull();
  });

  it.each([true, false])('a failed first read says it could not load (reply rights: %s), never "empty"', async (canReply) => {
    actions.listDocumentComments.mockRejectedValue(new Error('network'));
    open(canReply);
    expect((await screen.findByRole('alert')).textContent).toBe(en('engagements.comments.error.load_failed'));
    expect(screen.queryByText(en('engagements.comments.empty'))).toBeNull();
  });
});

describe('DocumentThreadPanel when a reply is refused', () => {
  it('an empty reply is said under the box and never sent', async () => {
    actions.listDocumentComments.mockResolvedValue([]);
    open();
    await screen.findByText(en('engagements.comments.empty'));
    fireEvent.click(screen.getByRole('button', { name: en('engagements.comments.reply') }));
    expect(actions.replyToDocument).not.toHaveBeenCalled();
    expect(document.getElementById(`reply-${ARTIFACT}-error`)?.textContent).toBe(en('errors.field.required'));
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it.each(['en', 'ar-EG'] as const)('a refused reply is said under the box (%s)', async (locale) => {
    actions.listDocumentComments.mockResolvedValue([]);
    renderWithIntl(<DocumentThreadPanel artifactId={ARTIFACT} canReply />, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'engagements.comments.open') }));
    await screen.findByText(messageAt(locale, 'engagements.comments.empty'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Is this oak?' } });
    await expectFieldErrorsRenderUnderFields({
      fields: ['body'],
      controlIdOf: () => `reply-${ARTIFACT}`,
      answerWith: (result) => actions.replyToDocument.mockResolvedValue(result),
      submit: async () => {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'engagements.comments.reply') }));
        });
      },
      locale,
      typed: { [`reply-${ARTIFACT}`]: 'Is this oak?' },
    });
  });

  it('a server refusal with no field is said above the box, by its cause', async () => {
    actions.listDocumentComments.mockResolvedValue([]);
    actions.replyToDocument.mockResolvedValue({ ok: false, error: 'engagement_not_active' });
    open();
    await screen.findByText(en('engagements.comments.empty'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: en('engagements.comments.reply') }));
    expect((await screen.findByRole('alert')).textContent).toBe(en('errors.engagement_not_active'));
  });
});
