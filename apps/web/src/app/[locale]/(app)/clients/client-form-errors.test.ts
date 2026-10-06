import { describe, expect, test } from 'vitest';
import { clientFieldFor } from './client-form-errors';

describe('clientFieldFor', () => {
  test('a missing name or phone belongs under its field', () => {
    expect(clientFieldFor('name_required')).toBe('name');
    expect(clientFieldFor('phone_required')).toBe('phone');
  });

  test('anything else is said above the footer', () => {
    expect(clientFieldFor('forbidden')).toBe('form');
    expect(clientFieldFor('generic')).toBe('form');
  });
});
