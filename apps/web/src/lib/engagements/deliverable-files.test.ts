import { describe, expect, it } from 'vitest';
import { WORKING_FILE_CATEGORIES } from './working-files';
import {
  CATEGORY_WRITE_KIND,
  MAX_DELIVERABLE_BYTES,
  validateDeliverableFile,
} from './deliverable-files';

describe('validateDeliverableFile — per-category extension gate', () => {
  it('accepts a DWG on the layout slot', () => {
    expect(validateDeliverableFile('layout', 'ground-floor.dwg', 1024)).toBeNull();
  });

  it('rejects XLSX on the render slot but accepts it on BOQ', () => {
    expect(validateDeliverableFile('render', 'boq.xlsx', 1024)).toBe('invalid');
    expect(validateDeliverableFile('boq', 'boq.xlsx', 1024)).toBeNull();
  });

  it('is case-insensitive on the extension', () => {
    expect(validateDeliverableFile('render', 'HERO.JPG', 1024)).toBeNull();
  });

  it('rejects an unknown extension as invalid', () => {
    expect(validateDeliverableFile('layout', 'notes.txt', 1024)).toBe('invalid');
  });

  it('rejects a filename with no extension as invalid', () => {
    expect(validateDeliverableFile('boq', 'estimate', 1024)).toBe('invalid');
  });
});

describe('validateDeliverableFile — size gate', () => {
  it('rejects a file over 100 MB with file_too_large', () => {
    expect(
      validateDeliverableFile('layout', 'huge.pdf', MAX_DELIVERABLE_BYTES + 1),
    ).toBe('file_too_large');
  });

  it('accepts a file exactly at the limit', () => {
    expect(
      validateDeliverableFile('layout', 'edge.pdf', MAX_DELIVERABLE_BYTES),
    ).toBeNull();
  });

  it('checks extension before size — a huge wrong-type file is invalid', () => {
    expect(
      validateDeliverableFile('render', 'sheet.xlsx', MAX_DELIVERABLE_BYTES + 1),
    ).toBe('invalid');
  });

  it('skips the size gate when size is unknown', () => {
    expect(validateDeliverableFile('layout', 'plan.pdf')).toBeNull();
  });
});

describe('CATEGORY_WRITE_KIND', () => {
  it('covers every working-file category', () => {
    for (const category of WORKING_FILE_CATEGORIES) {
      expect(CATEGORY_WRITE_KIND[category]).toBeTruthy();
    }
  });

  it('maps to the expected artifact kinds', () => {
    expect(CATEGORY_WRITE_KIND).toEqual({
      layout: 'autocad',
      render: 'approved_render',
      boq: 'boq',
      shopDrawing: 'shop_drawing',
      conceptOption: 'concept_option',
    });
  });

  it('shopDrawing is an upload category WITHOUT a pinned tray slot', () => {
    expect(WORKING_FILE_CATEGORIES).not.toContain('shopDrawing');
    expect(validateDeliverableFile('shopDrawing', 'wall-section.dwg', 1024)).toBeNull();
    expect(validateDeliverableFile('shopDrawing', 'boq.xlsx', 1024)).toBe('invalid');
  });

  it('conceptOption is an upload category WITHOUT a pinned tray slot', () => {
    expect(WORKING_FILE_CATEGORIES).not.toContain('conceptOption');
    expect(validateDeliverableFile('conceptOption', 'option-a.pdf', 1024)).toBeNull();
    expect(validateDeliverableFile('conceptOption', 'boq.xlsx', 1024)).toBe('invalid');
  });

  // The dead-end this category exists to fix: `optionsReady` counts
  // `concept_option` artifacts, so an upload category that writes `autocad` could
  // never clear it. The two must stay DISTINCT kinds — collapsing them makes
  // either optionsReady or spatialBaseReady unsatisfiable through the UI.
  it('writes concept_option for conceptOption and autocad for layout', () => {
    expect(CATEGORY_WRITE_KIND.conceptOption).toBe('concept_option');
    expect(CATEGORY_WRITE_KIND.layout).toBe('autocad');
    expect(CATEGORY_WRITE_KIND.conceptOption).not.toBe(CATEGORY_WRITE_KIND.layout);
  });
});
