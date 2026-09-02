import { describe, expect, it } from 'vitest';
import { groupByCategory } from './document-groups';

const doc = (id: string, categoryId: string | null, name = 'Cat') => ({
  id,
  categoryId,
  categoryNameEn: categoryId ? name : null,
  categoryNameAr: categoryId ? name : null,
});

describe('groupByCategory', () => {
  it('groups documents under their category', () => {
    const groups = groupByCategory([
      doc('a', 'c1', 'Contracts'),
      doc('b', 'c2', 'Drawings'),
      doc('c', 'c1', 'Contracts'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].categoryId).toBe('c1');
    expect(groups[0].documents.map((d) => d.id)).toEqual(['a', 'c']);
    expect(groups[1].documents.map((d) => d.id)).toEqual(['b']);
  });

  it('puts uncategorised documents in their own group, LAST', () => {
    // Not hidden and not dropped: every document uploaded before categories
    // existed is uncategorised, so on day one this is the biggest bucket.
    const groups = groupByCategory([
      doc('old', null),
      doc('new', 'c1', 'Contracts'),
    ]);
    expect(groups.map((g) => g.categoryId)).toEqual(['c1', null]);
    expect(groups[1].documents.map((d) => d.id)).toEqual(['old']);
  });

  it('returns a single uncategorised group when nothing is filed yet', () => {
    const groups = groupByCategory([doc('a', null), doc('b', null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].categoryId).toBeNull();
    expect(groups[0].documents).toHaveLength(2);
  });

  it('preserves the incoming order inside each group', () => {
    // The queries hand documents over newest-first; that must survive grouping.
    const groups = groupByCategory([
      doc('3rd', 'c1'),
      doc('2nd', 'c1'),
      doc('1st', 'c1'),
    ]);
    expect(groups[0].documents.map((d) => d.id)).toEqual(['3rd', '2nd', '1st']);
  });

  it('orders groups by first appearance, so the most recent category leads', () => {
    const groups = groupByCategory([
      doc('a', 'recent', 'Recent'),
      doc('b', 'older', 'Older'),
      doc('c', 'recent', 'Recent'),
    ]);
    expect(groups.map((g) => g.categoryId)).toEqual(['recent', 'older']);
  });

  it('handles an empty list', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
