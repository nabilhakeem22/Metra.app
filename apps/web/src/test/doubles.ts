import { vi, type Mock } from 'vitest';

// TEST-ONLY. The two mock shapes every DOM test in this suite needs, so that each
// `vi.mock` factory stays one line.

/** Every method `useRouter()` hands back, each a spy. */
export interface TestRouter {
  push: Mock;
  replace: Mock;
  refresh: Mock;
  back: Mock;
  forward: Mock;
  prefetch: Mock;
}

export function createTestRouter(): TestRouter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  };
}

/**
 * Spread over the REAL `@/i18n/routing` module: replaces only the two hooks that
 * need an App Router context.
 *
 * Never alias the module wholesale — it also exports `LOCALES`, `isRtl`, `dirFor`
 * and `routing`, and code under test reads those for real. `Link` is left real
 * too: it renders an anchor without a router context.
 */
export function routingDouble<T extends object>(
  actual: T,
  router: TestRouter,
  pathname: string,
): T {
  return {
    ...actual,
    useRouter: () => router,
    usePathname: () => pathname,
  };
}

/** One captured `toast(...)` call. */
export interface CapturedToast {
  title?: string;
  description?: string;
  variant?: string;
}
