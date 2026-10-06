import { describe, expect, it } from 'vitest';
import { cn } from './utils';

// The design tokens replace Tailwind's size and radius scales; these pin that
// cn() treats them as sizes and radii, not as colours or unknown classes.
describe('cn() knows the design tokens', () => {
  it('keeps a type token next to a text colour', () => {
    expect(cn('text-caption', 'text-muted-foreground')).toBe(
      'text-caption text-muted-foreground',
    );
  });

  it('lets a later type token win over an earlier one', () => {
    expect(cn('text-body', 'text-caption')).toBe('text-caption');
  });

  it('lets a later radius token win over an earlier one', () => {
    expect(cn('rounded-item', 'rounded-panel')).toBe('rounded-panel');
  });

  it('merges radius tokens on a logical side', () => {
    expect(cn('rounded-e-item', 'rounded-e-panel')).toBe('rounded-e-panel');
  });
});
