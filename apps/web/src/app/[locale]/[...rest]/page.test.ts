import { describe, expect, it, vi } from 'vitest';

const notFound = vi.hoisted(() =>
  vi.fn((): never => {
    throw new Error('not found');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));

const { default: UnknownPage } = await import('./page');

describe('the catch-all route under a locale', () => {
  it('answers every unknown path with the 404', () => {
    expect(() => UnknownPage()).toThrow('not found');
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
