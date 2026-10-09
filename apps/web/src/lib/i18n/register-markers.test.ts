import { describe, expect, it } from 'vitest';
// The i18n gate lives under scripts/, which has no test runner of its own; its
// pure matcher is pinned here so CI runs it.
import { egyptianMarkersIn } from '../../../../../scripts/i18n/lib/egyptian-markers';

describe('the register check matcher (F4, F7)', () => {
  it.each([
    ['alef-maqsura spellings', ['دى', 'اللى', 'تانى', 'دلوقتى', 'ازاى']],
    ['no hamza', ['ايه', 'امتى']],
    ['an attached و or ف', ['وده', 'ومش', 'فده', 'واللي']],
    ['tatweel, harakat and a zero-width joiner inside', ['مـش', 'مِش', 'م‌ش', 'د​ه']],
    ['the added words', ['بس', 'عايز', 'ليه', 'زي', 'كمان', 'خلاص', 'معلش', 'مافيش', 'كدا', 'بتاعك', 'بتاعت']],
  ])('catches %s', (_label, words) => {
    for (const word of words) expect(egyptianMarkersIn(`النص ${word}، هنا`), word).not.toEqual([]);
  });

  it.each([
    ['countries', 'تعمل الشركة في عدة دول.'],
    ['remained', 'ما بقي من المبلغ يُدفع عند التسليم.'],
    ['words that only contain a marker', 'مشروع الديكور في ديسمبر'],
    ['the deluxe and CD transliterations', 'غرفة دي لوكس مع سي دي'],
    ['plain فصحى', 'هذا الرابط لم يعد متاحًا. يُرجى التواصل مع فريق التصميم.'],
  ])('leaves %s alone', (_label, text) => {
    expect(egyptianMarkersIn(text)).toEqual([]);
  });
});
