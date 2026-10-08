import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ConceptOptionPicker } from './concept-option-picker';

// The client picks one released concept option: a confirm dialog first, the
// letter they saw sent with the choice, the saved letter in the confirmation,
// and "the options have changed" plus a refresh when the letter moved.

const actions = vi.hoisted(() => ({ chooseDeliveryConcept: vi.fn(), respondToDeliveryConcept: vi.fn() }));
vi.mock('../actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const OPTIONS = [
  { id: '11111111-1111-4111-8111-111111111111', position: 1 as const, letter: 'A' as const },
  { id: '22222222-2222-4222-8222-222222222222', position: 2 as const, letter: 'B' as const },
  { id: '33333333-3333-4333-8333-333333333333', position: 3 as const, letter: 'C' as const },
];
const isolated = (letter: string) => `⁨${letter}⁩`;
/** A catalogue string with its `{letter}` filled the way the picker fills it. */
function at(locale: TestLocale, path: string, values?: { letter: string }): string {
  const template = messageAt(locale, path);
  return values ? template.replace(/\{letter\}/g, isolated(values.letter)) : template;
}
const en = (path: string, values?: { letter: string }) => at('en', path, values);

function renderPicker(locale: TestLocale = 'en', canRequestChanges = true) {
  return renderWithIntl(
    <ConceptOptionPicker token="tok/1" options={OPTIONS} canRequestChanges={canRequestChanges} />,
    { locale },
  );
}

/** The card of one option, by its letter. */
function card(letter: string): HTMLElement {
  return document.querySelector(`[data-concept-option="${letter}"]`) as HTMLElement;
}

async function chooseAndConfirm(letter: string) {
  fireEvent.click(within(card(letter)).getByRole('button', { name: en('delivery.conceptPicker.choose') }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: en('delivery.conceptPicker.confirm', { letter }) }),
  );
  await act(async () => {});
}

beforeEach(() => {
  actions.chooseDeliveryConcept.mockReset();
  actions.respondToDeliveryConcept.mockReset();
  router.refresh.mockReset();
});

describe('ConceptOptionPicker', () => {
  it('one card per option, lettered in position order, each with View and Choose', () => {
    renderPicker('ar-EG');
    const cards = [...document.querySelectorAll('[data-concept-option]')];
    expect(cards.map((element) => element.getAttribute('data-concept-option'))).toEqual(['A', 'B', 'C']);
    expect(within(card('B')).getByText(at('ar-EG', 'delivery.conceptPicker.option', { letter: 'B' }))).toBeTruthy();
    const view = within(card('B')).getByRole('link', { name: messageAt('ar-EG', 'delivery.conceptPicker.view') });
    expect(view.getAttribute('href')).toBe(`/ar-EG/d/tok%2F1/documents/${OPTIONS[1].id}`);
    expect(view.getAttribute('target')).toBe('_blank');
    expect(view.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('asks first; Cancel calls no action', async () => {
    renderPicker();
    fireEvent.click(within(card('A')).getByRole('button', { name: en('delivery.conceptPicker.choose') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en('delivery.conceptPicker.confirmTitle', { letter: 'A' }))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: en('delivery.conceptPicker.cancel') }));
    await act(async () => {});
    expect(actions.chooseDeliveryConcept).not.toHaveBeenCalled();
  });

  it('Confirm sends the option, the letter it was seen under and the note, once', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText(en('delivery.actions.notePlaceholder')), {
      target: { value: 'The middle one' },
    });
    await chooseAndConfirm('B');
    expect(actions.chooseDeliveryConcept).toHaveBeenCalledTimes(1);
    expect(actions.chooseDeliveryConcept).toHaveBeenCalledWith('tok/1', OPTIONS[1].id, 2, 'The middle one');
    expect(await screen.findByText(en('delivery.conceptPicker.chosen', { letter: 'B' }))).toBeTruthy();
    expect(screen.getByText(en('delivery.hero.concept.approvedBodyNotified'))).toBeTruthy();
  });

  it('F1: a repeat names the SAVED letter, never the one just tapped', async () => {
    // Another tab chose B; this stale tab taps C and the write answers `already`.
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: false });
    renderPicker();
    await chooseAndConfirm('C');
    expect(await screen.findByText(en('delivery.conceptPicker.chosen', { letter: 'B' }))).toBeTruthy();
    expect(screen.queryByText(en('delivery.conceptPicker.chosen', { letter: 'C' }))).toBeNull();
    expect(screen.getByText(en('delivery.hero.concept.approvedBody'))).toBeTruthy();
    expect(screen.queryByText(en('delivery.hero.concept.approvedBodyNotified'))).toBeNull();
  });

  it('F1: a repeat over a plain approval names no letter at all', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'approved', studioNotified: true });
    renderPicker();
    await chooseAndConfirm('A');
    expect(await screen.findByText(en('delivery.hero.concept.approvedBodyNotified'))).toBeTruthy();
    expect(screen.queryByText(/You chose option/)).toBeNull();
  });

  it('F1: a repeat over a request for changes confirms the request, with no letter', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    renderPicker();
    await chooseAndConfirm('B');
    expect(await screen.findByText(en('delivery.hero.concept.changesTitle'))).toBeTruthy();
    expect(screen.getByText(en('delivery.hero.concept.changesBody'))).toBeTruthy();
    expect(screen.queryByText(/You chose option/)).toBeNull();
  });

  it('a letter that moved says the options changed and refreshes', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'options_changed' });
    renderPicker();
    await chooseAndConfirm('A');
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.conceptPicker.changed'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('F5: a review that closed says the step moved on, in Arabic too, and refreshes', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'moved_on' });
    renderPicker('ar-EG');
    fireEvent.click(
      within(card('A')).getByRole('button', { name: at('ar-EG', 'delivery.conceptPicker.choose') }),
    );
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: at('ar-EG', 'delivery.conceptPicker.confirm', { letter: 'A' }) }),
    );
    await act(async () => {});
    expect((await screen.findByRole('alert')).textContent).toBe(at('ar-EG', 'delivery.conceptPicker.movedOn'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('any other refusal is the portal error message, with no refresh', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'error', error: 'token_expired' });
    renderPicker();
    await chooseAndConfirm('A');
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.actions.error.token_expired'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('Request changes stays while offered, through the concept respond action', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.concept.changes') }));
    await act(async () => {});
    expect(actions.respondToDeliveryConcept).toHaveBeenCalledWith('tok/1', 'request_concept_changes', '');
    expect(await screen.findByText(en('delivery.hero.concept.changesBody'))).toBeTruthy();
    expect(actions.chooseDeliveryConcept).not.toHaveBeenCalled();
  });

  it('a retracted change request holding its slot: Request changes is not offered', () => {
    renderPicker('en', false);
    expect(screen.queryByRole('button', { name: en('delivery.hero.concept.changes') })).toBeNull();
    expect(screen.getAllByRole('button', { name: en('delivery.conceptPicker.choose') })).toHaveLength(3);
  });

  it('a stale Request changes over a saved choice says the choice, never "changes requested"', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.concept.changes') }));
    expect(await screen.findByText(en('delivery.conceptPicker.chosen', { letter: 'B' }))).toBeTruthy();
    expect(screen.queryByText(en('delivery.hero.concept.changesTitle'))).toBeNull();
  });

  it('a repeat with nothing live on file says the step moved on and refreshes', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'moved_on' });
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.concept.changes') }));
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.conceptPicker.movedOn'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
