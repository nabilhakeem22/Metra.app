import 'server-only';
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

/**
 * The letter position (1 = A to 4 = D) of each concept option the CLIENT can
 * see on this delivery, keyed by artifact id. Read from the ONE lettering rule,
 * app_concept_option_positions (40-delivery-read.sql), which the portal and the
 * choose function also read, so the studio never letters an option differently
 * from the client and never re-ranks in JS (attested_at has microseconds; a JS
 * Date keeps milliseconds).
 *
 * Runs inside the CALLER's org transaction: the function is SECURITY INVOKER, so
 * as metra_app it sees only this org's artifacts and files (RLS), and a foreign
 * engagement id reads as an empty map.
 */
export async function conceptOptionPositions(
  tx: MetraDb,
  engagementId: string,
): Promise<Map<string, number>> {
  const rows = (await tx.execute(sql`
    select artifact_id as "artifactId", option_position as "optionPosition"
    from public.app_concept_option_positions(${engagementId}::uuid)
  `)) as unknown as Array<{ artifactId: string; optionPosition: number }>;
  return new Map(rows.map((row) => [row.artifactId, Number(row.optionPosition)]));
}
