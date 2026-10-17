import 'server-only';
import type { MetraDb } from '@metra/db';
import { isCloudflareRuntime } from '@/lib/cf/context';
import { createRuntimeConnection, getDb } from './client';

/**
 * A database handle for ONE piece of work that runs after the response
 * (`after()`), and the call that releases it.
 *
 * Not the request's shared connection: that one is closed by its own
 * `after()` teardown (./request-connection.ts), and Next runs every `after()`
 * callback at once, so work on it could find the socket ending between two
 * statements of its transaction. On the Cloudflare runtime this is a
 * connection of its own, one socket, created now (inside the request, where
 * the binding is read) and connected on first use; off-platform it is the
 * process-lived pool, which is never closed here.
 */
export function afterResponseConnection(): { db: MetraDb; release: () => Promise<void> } {
  if (!isCloudflareRuntime()) return { db: getDb(), release: async () => {} };
  const { db, sql } = createRuntimeConnection(1);
  return { db, release: () => sql.end({ timeout: 5 }) };
}
