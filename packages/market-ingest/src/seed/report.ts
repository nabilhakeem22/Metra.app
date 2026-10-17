// The per-studio lines `market:seed-price-books` prints (dry run and real run
// alike), and the totals.
import { SKIP_REASONS, type SkipReason } from '@metra/db/market-seed';
import type { SeedRun } from './run';

const REASON_WORDS: Record<SkipReason, string> = {
  already_linked: 'already linked',
  discontinued: 'discontinued',
  unit_unsupported: 'unit unsupported (bag, pack, thousand_bricks)',
  no_price: 'no price',
  code_clash: 'code clash',
  name_clash: 'name clash',
};

export function seedReport(run: SeedRun, dryRun: boolean): string[] {
  const verb = dryRun ? 'to create' : 'created';
  const lines = [`${dryRun ? 'DRY RUN, nothing is written. ' : ''}${run.marketItems} published market item(s); ${run.outcomes.length} studio(s).`];
  let sections = 0;
  let items = 0;
  for (const outcome of run.outcomes) {
    lines.push(`studio "${outcome.studio.name}" (${outcome.studio.id})`);
    if (outcome.status === 'no_actor') {
      lines.push('  skipped: the studio has no owner or admin membership');
      continue;
    }
    if (outcome.status === 'failed') {
      lines.push(`  FAILED, nothing written for this studio: ${outcome.error}`);
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
  const failed = run.outcomes.filter((outcome) => outcome.status === 'failed').length;
  lines.push(`totals: sections ${verb} ${sections}, items ${verb} ${items}, studios failed ${failed}`);
  return lines;
}
