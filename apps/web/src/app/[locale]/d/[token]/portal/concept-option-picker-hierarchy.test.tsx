import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderCommandCard } from '@/test/portal-command-card';
import { messageAt } from '@/test/render-with-intl';

// Round D (w3b F10, B12 half): the button hierarchy of the concept picker. Every
// "Choose this option" is secondary, so the picker itself shows no filled button;
// while the confirm dialog is open, its confirm is the one filled button.

vi.mock('../review-actions', () => ({ chooseDeliveryConcept: vi.fn(), respondToDeliveryConcept: vi.fn() }));
vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const OPTIONS = [
  { id: '11111111-1111-4111-8111-111111111111', position: 1 as const, letter: 'A' as const },
  { id: '22222222-2222-4222-8222-222222222222', position: 2 as const, letter: 'B' as const },
  { id: '33333333-3333-4333-8333-333333333333', position: 3 as const, letter: 'C' as const },
];
const FILLED = 'bg-[image:var(--brand-grad)]';
const SECONDARY = 'bg-[color:var(--glass-btn)]';
const en = (path: string) => messageAt('en', path);

/** Every filled button in the document, including those a modal hides from the a11y tree. */
function filledButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { hidden: true }).filter((button) => button.className.includes(FILLED));
}

describe('ConceptOptionPicker button hierarchy', () => {
  it('three options render no filled button; every Choose is secondary', () => {
    renderCommandCard({
      hero: { kind: 'action', group: 'concept', showRomAck: false },
      clientActions: ['approve_concept', 'request_concept_changes'],
      conceptOptions: OPTIONS,
    });
    const chooseButtons = screen.getAllByRole('button', { name: en('delivery.conceptPicker.choose') });
    expect(chooseButtons).toHaveLength(3);
    for (const button of chooseButtons) expect(button.className).toContain(SECONDARY);
    expect(filledButtons()).toEqual([]);
  });

  it('with the confirm dialog open, its confirm is the only filled button', async () => {
    renderCommandCard({
      hero: { kind: 'action', group: 'concept', showRomAck: false },
      clientActions: ['approve_concept'],
      conceptOptions: OPTIONS,
    });
    const card = document.querySelector('[data-concept-option="B"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: en('delivery.conceptPicker.choose') }));
    const dialog = await screen.findByRole('alertdialog');
    const filled = filledButtons();
    expect(filled).toHaveLength(1);
    expect(dialog.contains(filled[0])).toBe(true);
    expect(filled[0].textContent).toBe(en('delivery.conceptPicker.confirm').replace(/\{letter\}/g, '⁨B⁩'));
  });
});
