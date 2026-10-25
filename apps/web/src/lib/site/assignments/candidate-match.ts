// Does a studio member match what a manager typed in the site team picker?
// PURE. What he typed starts the name, starts it from any word on («عبد الل»
// finds «محمود عبد الله»), or starts the email, folded the way every search in
// the app folds (lib/search/fold.ts).
import { searchForm } from '@/lib/search/fold';
import type { SiteTeamPerson } from './types';

export function matchesMemberSearch(person: Pick<SiteTeamPerson, 'name' | 'email'>, query: string): boolean {
  const wanted = searchForm(query);
  if (wanted === '') return true;
  const words = searchForm(person.name).split(' ');
  if (words.some((_word, index) => words.slice(index).join(' ').startsWith(wanted))) return true;
  return searchForm(person.email).startsWith(wanted);
}
