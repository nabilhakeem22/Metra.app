import 'server-only';
// A new studio gets the market price book AUTOMATICALLY, after its sign-up
// response has gone: the studio already exists (createOrgCore committed), so
// the seed can neither fail nor slow the sign-up. It runs in its own RLS
// transaction as the new owner, on a connection of its own (see
// afterResponseConnection), and a failure is one redacted log line: the
// studio's empty price book still offers the same load.
import { withOrgContext, type MetraDb } from '@metra/db';
import { after } from 'next/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { afterResponseConnection } from '@/lib/db/after-response-connection';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { SEED_SOURCES, seedStudioPriceBook } from './seed-core';

/** Seed the new studio's price book now, on `db`. Never throws; logs counts only (no id, no name). */
export async function seedNewStudio(db: MetraDb, ctx: OrgContext): Promise<void> {
  if (!can(ctx.role, 'price_book', 'create')) return;
  try {
    const summary = await withOrgContext(db, ctx, (tx) => seedStudioPriceBook(tx, SEED_SOURCES.signup));
    console.info('market seed on sign-up:', summary);
  } catch (err) {
    console.error('market seed on sign-up failed:', loggableFailure(err));
  }
}

/** Seed, then close the connection; a failed close is logged redacted, never thrown into `after()`. */
async function seedThenRelease(db: MetraDb, release: () => Promise<void>, ctx: OrgContext): Promise<void> {
  await seedNewStudio(db, ctx);
  try {
    await release();
  } catch (err) {
    console.error('market seed on sign-up: closing its connection failed:', loggableFailure(err));
  }
}

/** Schedule the seed for after the sign-up response. Never throws. */
export function seedAfterSignup(ctx: OrgContext): void {
  try {
    const { db, release } = afterResponseConnection();
    after(() => seedThenRelease(db, release, ctx));
  } catch (err) {
    console.error('market seed on sign-up not scheduled:', loggableFailure(err));
  }
}
