// The per-studio lines `market:seed-price-books` prints (dry run and real run
// alike), and the totals.
import { SKIP_REASONS, type SkipReason } from '@metra/db/market-seed';
import { stoppedBy, type SeedRun, type StoppingOutcome, type StudioOutcome } from './run';

const REASON_WORDS: Record<SkipReason, string> = {
  already_linked: 'already linked',
  discontinued: 'discontinued',
  unit_unsupported: 'unit unsupported (bag, pack, thousand_bricks)',
  no_price: 'no price',
  code_clash: 'code clash',
  name_clash: 'name clash',
};

const STOP_CAUSES: Record<StoppingOutcome['status'], string> = {
  book_changed: 'the market price book changed during this run',
  connection_lost: 'the connection to the database was lost during this run',
};

type UnplannedOutcome = Exclude<StudioOutcome, { plan: unknown }>;

/** The one line of a studio that has no plan. */
function unplannedLine(outcome: UnplannedOutcome): string {
  switch (outcome.status) {
    case 'no_actor':
      return '  skipped: the studio has no owner or admin membership';
    case 'failed':
      return `  FAILED, nothing written for this studio: ${outcome.error}`;
    case 'book_changed':
      return '  STOPPED, nothing written for this studio: the market price book changed during this run (a publish or withdrawal)';
    case 'connection_lost':
      return `  CONNECTION LOST on this studio, the run stopped here: ${outcome.error}. It was written only if its commit had reached the database; a re-run completes it`;
    case 'not_reached':
      return '  not reached: the run stopped before this studio';
  }
}

export function seedReport(run: SeedRun, dryRun: boolean): string[] {
  const verb = dryRun ? 'to create' : 'created';
  const lines = [`${dryRun ? 'DRY RUN, nothing is written. ' : ''}${run.marketItems} published market item(s); ${run.outcomes.length} studio(s).`];
  let sections = 0;
  let items = 0;
  for (const outcome of run.outcomes) {
    lines.push(`studio "${outcome.studio.name}" (${outcome.studio.id})`);
    if (!('plan' in outcome)) {
      lines.push(unplannedLine(outcome));
      continue;
    }
    const { plan } = outcome;
    const qualified = plan.sectionsToCreate.filter((section) => section.qualified).length;
    const skippedTotal = SKIP_REASONS.reduce((sum, reason) => sum + plan.skipped[reason], 0);
    lines.push(`  actor ${outcome.actor.userId} (${outcome.actor.role})`);
    lines.push(`  sections: ${verb} ${plan.sectionsToCreate.length}, already present ${plan.sectionsPresent}${qualified > 0 ? ` (${qualified} named with their category, the plain name being taken)` : ''}`);
    lines.push(`  items: ${verb} ${plan.itemsToCreate.length}, skipped ${skippedTotal}`);
    lines.push(`    ${SKIP_REASONS.map((reason) => `${REASON_WORDS[reason]} ${plan.skipped[reason]}`).join(', ')}`);
    sections += plan.sectionsToCreate.length;
    items += plan.itemsToCreate.length;
  }
  const failed = run.outcomes.filter((outcome) => outcome.status === 'failed' || outcome.status === 'connection_lost').length;
  lines.push(`totals: sections ${verb} ${sections}, items ${verb} ${items}, studios failed ${failed}`);
  const stop = run.outcomes.find(stoppedBy);
  if (stop) lines.push(`STOPPED: ${STOP_CAUSES[stop.status]}. Run the same command again: it plans from the book as it is then and creates nothing twice.`);
  return lines;
}
