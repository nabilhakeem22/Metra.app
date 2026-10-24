import { describe, expect, it } from 'vitest';
import { typedDescriptionColumn, typedHeaderColumns } from './typed-columns';

describe('a change order is saved in the language it was typed in', () => {
  it('the Arabic page fills the Arabic title and reason, and leaves the English ones out', () => {
    expect(typedHeaderColumns('ar-EG', { title: 'باب إضافي', reason: 'طلب العميل' })).toEqual({
      titleAr: 'باب إضافي',
      reasonAr: 'طلب العميل',
    });
    expect(typedDescriptionColumn('ar-EG', 'باب خشب')).toEqual({ descriptionAr: 'باب خشب' });
  });

  it('the English page fills the English columns', () => {
    expect(typedHeaderColumns('en', { title: 'Extra door', reason: '' })).toEqual({ titleEn: 'Extra door', reasonEn: null });
    expect(typedDescriptionColumn('en', 'Oak door')).toEqual({ descriptionEn: 'Oak door' });
  });
});
