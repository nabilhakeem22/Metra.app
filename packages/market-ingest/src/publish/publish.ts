// `market:publish`: inside ONE transaction, under the market write lock and
// timeouts, re-run the gate against the published history, refuse unless its
// output hashes to the approved value, and write exactly that output. Nothing
// read from staged.json is ever written. Everything or nothing.
import { MARKET_WRITE_LOCK } from '@metra/db/market-seed';
import { applyMarketWriteTimeouts } from '@metra/db/lock-timeout';
import { computeCheck } from '../commands/perform-check';
import type { PostgresJs, Transaction } from '../db/connection';
import { loadHistory } from '../history/load';
import { refreshSeedBook } from '../seed/book-store';
import type { StagedBulletin } from '../stage';
import { approvedStaged } from './approve';
import { refreshItemDetails } from './details';
import { withdrawInTransaction } from './withdraw';
import { discontinueItems, insertDetails, insertObservations, upsertCategories, writeItems } from './writes';

export interface PublishRequest {
  period: string;
  approve: string;
  reviewer: string;
  replace: boolean;
  pdfPath: string | undefined;
  mdPath: string | undefined;
  /** The clean gate's commit (requireCleanGate). */
  gateCommit: string;
}

export interface PublishSummary {
  bulletinId: string;
  replaced: boolean;
  categories: number;
  itemsCreated: number;
  itemsUpdated: number;
  discontinued: number;
  observations: number;
}

async function settlePeriod(tx: Transaction, staged: StagedBulletin, replace: boolean): Promise<boolean> {
  const [current] = await tx<Array<{ id: string }>>`
    select id from market_bulletins where publisher = ${staged.publisher} and period_month = ${`${staged.period}-01`} and status = 'published'`;
  if (current && !replace) {
    throw new Error(`a bulletin for ${staged.period} is already published; pass --replace to withdraw it and publish this one`);
  }
  if (current) await withdrawInTransaction(tx, current.id, 'replaced');
  return Boolean(current);
}

async function insertBulletin(tx: Transaction, staged: StagedBulletin, request: PublishRequest, discontinuedIds: string[]): Promise<string> {
  const source = staged.source!;
  const [row] = await tx<Array<{ id: string }>>`
    insert into market_bulletins (publisher, period_month, status, source_pdf_file_name, source_pdf_sha256,
      source_md_file_name, source_md_sha256, source_page_count, extraction_method, extraction_sha256,
      gate_commit, discontinued_item_ids, reviewed_by, reviewed_at)
    values (${staged.publisher}, ${`${staged.period}-01`}, 'published', ${source.pdfFileName}, ${source.pdfSha256},
      ${source.mdFileName}, ${source.mdSha256}, ${source.lastPrintedPage}, ${`session:${staged.readFrom}`}, ${request.approve},
      ${request.gateCommit}, ${discontinuedIds}::uuid[], ${request.reviewer}, now())
    returning id`;
  return row.id;
}

export async function publishPeriod(sql: PostgresJs, request: PublishRequest): Promise<PublishSummary> {
  await applyMarketWriteTimeouts(sql);
  return (await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    const history = await loadHistory(tx, request.period);
    const run = computeCheck({ period: request.period, offline: false, pdfPath: request.pdfPath, mdPath: request.mdPath }, history, request.gateCommit);
    const staged = approvedStaged(run, request.period, request.approve);
    const replaced = await settlePeriod(tx, staged, request.replace);
    await upsertCategories(tx, staged);
    const items = await writeItems(tx, staged);
    const discontinuedIds = await discontinueItems(tx, staged.discontinue);
    const bulletinId = await insertBulletin(tx, staged, request, discontinuedIds);
    await insertDetails(tx, staged, bulletinId);
    await insertObservations(tx, staged, bulletinId, items.ids);
    await refreshItemDetails(tx, [...items.ids.values()]);
    await refreshSeedBook(tx);
    return {
      bulletinId,
      replaced,
      categories: staged.categories.length,
      itemsCreated: items.created,
      itemsUpdated: staged.items.length - items.created,
      discontinued: discontinuedIds.length,
      observations: staged.observations.length,
    };
  })) as PublishSummary;
}
