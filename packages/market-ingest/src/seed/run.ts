// `market:seed-price-books`: fill every studio's price book (or the --org ones)
// from the published market book. ONE TRANSACTION PER STUDIO: a studio is
// seeded completely or not at all, one studio's failure (a code a studio typed
// in the same second, say) cannot undo another's, each transaction holds its
// locks for one studio only, and a re-run (idempotent) retries just the
// studios that failed. Returns one result per studio, in organization order.
import type { MetraDb } from '@metra/db';
import type { PostgresJs } from '../db/connection';
import type { SeedPlan } from './plan';
import { readActor, readMarketSeedItems, readStudios, type Studio } from './read';
import { seedStudio } from './write';

export type StudioOutcome =
  | { studio: Studio; status: 'planned' | 'seeded'; actor: { userId: string; role: 'owner' | 'admin' }; plan: SeedPlan }
  | { studio: Studio; status: 'no_actor' }
  | { studio: Studio; status: 'failed'; error: string };

export interface SeedRun {
  marketItems: number;
  outcomes: StudioOutcome[];
}

export async function runSeed(db: MetraDb, sql: PostgresJs, options: { dryRun: boolean; orgIds: string[] }): Promise<SeedRun> {
  const marketItems = await readMarketSeedItems(sql);
  const studios = await readStudios(sql, options.orgIds);
  const missing = options.orgIds.filter((id) => !studios.some((studio) => studio.id === id));
  if (missing.length > 0) throw new Error(`no organization ${missing.join(', ')}`);
  const outcomes: StudioOutcome[] = [];
  for (const studio of studios) {
    const actor = await readActor(sql, studio.id);
    if (actor === null) {
      outcomes.push({ studio, status: 'no_actor' });
      continue;
    }
    try {
      const plan = await seedStudio(db, { orgId: studio.id, ...actor }, marketItems, options.dryRun);
      outcomes.push({ studio, status: options.dryRun ? 'planned' : 'seeded', actor, plan });
    } catch (error) {
      outcomes.push({ studio, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { marketItems: marketItems.length, outcomes };
}
