import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ByLoginMode } from './login-mode';

// The login page is static HTML with the sign-in framing; `?mode=signup` swaps
// the framing in the browser, and anything else keeps sign-in.

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));

beforeEach(() => {
  search.value = '';
});
afterEach(cleanup);

describe('ByLoginMode', () => {
  it.each([
    ['?mode=signup', 'Create account'],
    ['?mode=signin', 'Sign in'],
    ['?mode=other', 'Sign in'],
    ['', 'Sign in'],
  ])('%s shows %s', (query, expected) => {
    search.value = query;
    render(<ByLoginMode signin="Sign in" signup="Create account" />);
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
