import { describe, expect, test } from 'vitest';
import { projectFieldFor } from './project-form-errors';

describe('projectFieldFor', () => {
  test.each([
    ['name_required', 'name'],
    ['code_required', 'code'],
    ['client_required', 'client'],
    ['start_date_required', 'startDate'],
    ['invalid_dates', 'endDate'],
  ] as const)('%s belongs under %s', (code, field) => {
    expect(projectFieldFor(code)).toBe(field);
  });

  test('anything else is said above the footer', () => {
    expect(projectFieldFor('forbidden')).toBe('form');
  });
});
