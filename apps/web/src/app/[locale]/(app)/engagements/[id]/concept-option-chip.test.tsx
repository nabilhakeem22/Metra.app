import { describe, expect, it } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ConceptOptionChip } from './concept-option-chip';

// F2: the client's pick carries ONE letter, the saved one, whatever its current
// position; every other option carries its current letter.

const fill = (path: string, letter: string) =>
  messageAt('ar-EG', path).replace('{letter}', `⁨${letter}⁩`);

describe('ConceptOptionChip', () => {
  it('the chosen option shows only the SAVED letter, even when its current one moved', () => {
    const { container } = renderWithIntl(<ConceptOptionChip letter="C" chosenLetter="B" />);
    expect(container.querySelector('[data-client-choice-chip]')?.textContent).toBe(
      fill('engagements.conceptOption.clientChoice', 'B'),
    );
    expect(container.querySelector('[data-option-letter]')).toBeNull();
    expect(container.textContent).not.toContain('C');
  });

  it('the chosen option keeps its saved letter after it is hidden', () => {
    const { container } = renderWithIntl(<ConceptOptionChip letter={null} chosenLetter="B" />);
    expect(container.querySelector('[data-client-choice-chip]')?.getAttribute('data-client-choice-chip')).toBe('B');
  });

  it('another option shows its current letter, and nothing while not released', () => {
    const { container } = renderWithIntl(<ConceptOptionChip letter="B" chosenLetter={null} />);
    expect(container.querySelector('[data-option-letter]')?.textContent).toBe(
      fill('engagements.conceptOption.letter', 'B'),
    );
    const hidden = renderWithIntl(<ConceptOptionChip letter={null} chosenLetter={null} />);
    expect(hidden.container.textContent).toBe('');
  });
});
