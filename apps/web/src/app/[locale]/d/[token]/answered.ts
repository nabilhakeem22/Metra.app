import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';

/**
 * One portal act, answered: NOTHING THROWS TO THE CLIENT (D3 L1, Round E R3).
 * A failure underneath answers `failure` (the act's own generic error) and logs
 * ONE line through loggableFailure, which copies the driver's error fields
 * (the SQLSTATE: 55P03 when a lock wait gave up) and never the failed query's
 * parameters, so no token hash, IP, user agent, note or comment body reaches
 * the Worker log.
 */
export async function answered<T, F>(act: string, failure: F, run: () => Promise<T>): Promise<T | F> {
  try {
    return await run();
  } catch (error) {
    console.error('portal act failed', { act, error: loggableFailure(error) });
    return failure;
  }
}
