import { describe, expect, it } from 'vitest';
import { matchesMemberSearch } from './candidate-match';

// The site team picker's search (S3 ruling): the start of a member's name, of
// any word of it, or of his email.

const MAHMOUD = { name: 'محمود عبد الله', email: 'mahmoud@studio.example' };
const LAILA = { name: 'Laila Fathy', email: 'laila@studio.example' };
const UNNAMED = { name: null, email: 'site.temp@studio.example' };

describe('matchesMemberSearch', () => {
  it('matches everyone while nothing is typed', () => {
    expect([MAHMOUD, LAILA, UNNAMED].every((person) => matchesMemberSearch(person, '  '))).toBe(true);
  });

  it('matches the start of the name or of any word of it', () => {
    expect(matchesMemberSearch(MAHMOUD, 'محمو')).toBe(true);
    expect(matchesMemberSearch(MAHMOUD, 'عبد')).toBe(true);
    expect(matchesMemberSearch(MAHMOUD, 'عبد الل')).toBe(true);
    expect(matchesMemberSearch(LAILA, 'fat')).toBe(true);
    expect(matchesMemberSearch(LAILA, 'LAI'), 'case does not matter').toBe(true);
  });

  it('matches the start of the email, and the email of a member with no name', () => {
    expect(matchesMemberSearch(LAILA, 'laila@')).toBe(true);
    expect(matchesMemberSearch(UNNAMED, 'site.t')).toBe(true);
  });

  it('folds the spellings a studio types interchangeably', () => {
    expect(matchesMemberSearch({ name: 'أحمد إبراهيم', email: null }, 'احمد')).toBe(true);
    expect(matchesMemberSearch({ name: 'أحمد إبراهيم', email: null }, 'ابرا')).toBe(true);
  });

  it('does not match the middle of a word or of the email', () => {
    expect(matchesMemberSearch(LAILA, 'ila')).toBe(false);
    expect(matchesMemberSearch(LAILA, 'studio')).toBe(false);
    expect(matchesMemberSearch(UNNAMED, 'temp')).toBe(false);
    expect(matchesMemberSearch({ name: null, email: null }, 'a')).toBe(false);
  });
});
