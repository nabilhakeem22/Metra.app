import { describe, expect, test } from 'vitest';
import { contactFieldFor } from './contact-form-errors';

describe('contactFieldFor', () => {
  test('a missing name belongs under the name; anything else above the footer', () => {
    expect(contactFieldFor('name_required')).toBe('name');
    expect(contactFieldFor('forbidden')).toBe('form');
    expect(contactFieldFor('generic')).toBe('form');
  });
});
