import { ENGAGEMENT_ARTIFACT_KINDS } from '@metra/db';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_FILE_SLUG,
  KIND_CATEGORY,
  isClientDocumentKind,
  type ClientDocumentCategory,
} from './portal-documents';

const CATEGORIES: ClientDocumentCategory[] = [
  'concept',
  'layout',
  'render',
  'drawing',
  'boq',
  'survey',
];

describe('portal document vocabulary', () => {
  it('maps EVERY artifact kind to a client-facing category', () => {
    for (const kind of ENGAGEMENT_ARTIFACT_KINDS) {
      expect(KIND_CATEGORY[kind]).toBeTruthy();
      expect(CATEGORIES).toContain(KIND_CATEGORY[kind]);
    }
    expect(Object.keys(KIND_CATEGORY).sort()).toEqual(
      [...ENGAGEMENT_ARTIFACT_KINDS].sort(),
    );
  });

  it('names every category with an ASCII, filename-safe slug', () => {
    for (const category of CATEGORIES) {
      const slug = CATEGORY_FILE_SLUG[category];
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
    expect(Object.keys(CATEGORY_FILE_SLUG).sort()).toEqual([...CATEGORIES].sort());
  });

  it('never routes a raw artifact kind through as the client-facing label', () => {
    // The kind names themselves must not be what the client sees.
    expect(KIND_CATEGORY.concept_option).toBe('concept');
    expect(KIND_CATEGORY.autocad).toBe('layout');
    expect(KIND_CATEGORY.approved_render).toBe('render');
    expect(KIND_CATEGORY.shop_drawing).toBe('drawing');
    expect(KIND_CATEGORY.boq).toBe('boq');
    expect(KIND_CATEGORY.survey).toBe('survey');
  });

  it('isClientDocumentKind accepts only known kinds', () => {
    for (const kind of ENGAGEMENT_ARTIFACT_KINDS) {
      expect(isClientDocumentKind(kind)).toBe(true);
    }
    for (const hostile of [
      null,
      undefined,
      42,
      {},
      [],
      '',
      'not_a_kind',
      'toString',
      'constructor',
      '__proto__',
    ]) {
      expect(isClientDocumentKind(hostile)).toBe(false);
    }
  });
});
