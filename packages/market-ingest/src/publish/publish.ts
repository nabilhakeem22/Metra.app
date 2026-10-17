// `market:publish`: write one approved staged.json in ONE transaction, with the
// migrator's lock and statement timeouts. Everything or nothing: a failure at
// any step rolls the whole publish back.
import { applyMigrationTimeouts } from '@metra/db/lock-timeout';
import type { PostgresJs, Transaction } from '../db/connection';
import type { StagedBulletin } from '../stage';
import { discontinueItems, insertObservations, upsertCategories, writeItems } from './writes';

export interface PublishOptions {
  reviewer: string;
  replace: boolean;
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

/** One publish at a time, whoever runs it. */
const PUBLISH_LOCK = 'metra.market.publish';

async function settlePeriod(tx: Transaction, staged: StagedBulletin, replace: boolean): Promise<boolean> {
  const period = `${staged.period}-01`;
  const [current] = await tx<{ id: string }[]>`
    select id from market_bulletins where publisher = ${staged.publisher} and period_month = ${period} and status = 'published'`;
  if (current && !replace) {
    throw new Error(`a bulletin for ${staged.period} is already published; pass --replace to withdraw it and publish this one`);
  }
  if (current) {
    await tx`update market_bulletins set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = 'replaced' where id = ${current.id}`;
  }
  const source = staged.source!;
  const [reused] = await tx<{ period: string }[]>`
    select to_char(period_month, 'YYYY-MM') as period from market_bulletins
     where status = 'published' and period_month <> ${period}
       and ((${source.pdfSha256}::text is not null and source_pdf_sha256 = ${source.pdfSha256})
         or (${source.mdSha256}::text is not null and source_md_sha256 = ${source.mdSha256}))`;
  if (reused) throw new Error(`this source file is already published as the ${reused.period} bulletin`);
  return Boolean(current);
}

async function insertBulletin(tx: Transaction, staged: StagedBulletin, sha256: string, reviewer: string): Promise<string> {
  const source = staged.source!;
  const [row] = await tx<{ id: string }[]>`
    insert into market_bulletins (publisher, period_month, status, source_pdf_file_name, source_pdf_sha256,
      source_md_file_name, source_md_sha256, source_page_count, extraction_method, extraction_sha256,
      reviewed_by, reviewed_at)
    values (${staged.publisher}, ${`${staged.period}-01`}, 'published', ${source.pdfFileName}, ${source.pdfSha256},
      ${source.mdFileName}, ${source.mdSha256}, ${source.lastPrintedPage}, ${`session:${staged.readFrom}`}, ${sha256},
      ${reviewer}, now())
    returning id`;
  return row.id;
}

export async function publishStaged(
  sql: PostgresJs,
  staged: StagedBulletin,
  sha256: string,
  options: PublishOptions,
): Promise<PublishSummary> {
  await applyMigrationTimeouts(sql);
  return (await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${PUBLISH_LOCK}))`;
    const replaced = await settlePeriod(tx, staged, options.replace);
    await upsertCategories(tx, staged);
    const items = await writeItems(tx, staged);
    await discontinueItems(tx, staged.discontinue);
    const bulletinId = await insertBulletin(tx, staged, sha256, options.reviewer);
    await insertObservations(tx, staged, bulletinId, items.ids);
    return {
      bulletinId,
      replaced,
      categories: staged.categories.length,
      itemsCreated: items.created,
      itemsUpdated: staged.items.length - items.created,
      discontinued: staged.discontinue.length,
      observations: staged.observations.length,
    };
  })) as PublishSummary;
}
