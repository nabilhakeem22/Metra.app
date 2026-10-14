import 'server-only';
import { portalActFailure, type PortalFailure } from '@/lib/share/portal-act-failure';

/**
 * One portal act, answered: NOTHING THROWS TO THE CLIENT (D3 L1, Round E R3).
 * A failure underneath answers `failureOf(failure)`, the act's own shape of
 * `uncertain` (a write that may still have committed) or `generic` with the
 * reference of its one redacted log line (../../../../lib/share/portal-act-failure.ts).
 */
export async function answered<T, F>(
  act: string,
  failureOf: (failure: PortalFailure) => F,
  run: () => Promise<T>,
): Promise<T | F> {
  try {
    return await run();
  } catch (error) {
    return failureOf(portalActFailure(act, error));
  }
}
