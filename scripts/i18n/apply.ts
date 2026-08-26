/**
 * i18n:apply — promote the generated catalog to the real one, gated on
 * FATAL-only validation.
 *
 *   npm run i18n:apply
 *
 * Runs the local validator (non-strict → plural gaps stay WARNINGs and do NOT
 * block) against ar-EG.generated.json. If there are zero FATALs, overwrites
 * ar-EG.json with it and deletes the generated file. Refuses (non-zero) if any
 * FATAL is found or the generated file is missing. Pure-local; no API key.
 */
import { existsSync, rmSync } from 'node:fs';
import {
  AR_GENERATED_PATH,
  AR_PATH,
  readCatalog,
  writeCatalog,
} from './lib/paths';
import { countFindings, printBucket, validate } from './lib/validator';

function main(): void {
  if (!existsSync(AR_GENERATED_PATH)) {
    console.error(
      `No generated catalog at ${AR_GENERATED_PATH}. Run ` +
        '`npm run i18n:translate` first. Nothing to apply.',
    );
    process.exit(1);
  }

  console.log('i18n:apply — validating generated catalog (FATAL-only gate)...');
  const report = validate(AR_GENERATED_PATH, false);
  const fatalCount = printBucket('FATAL', report.fatal);
  const warningCount = countFindings(report.warning);
  if (warningCount > 0) {
    console.log(
      `(${warningCount} plural-completeness warning(s) — non-blocking for apply.)`,
    );
  }

  if (fatalCount > 0) {
    console.error(
      '\nRefusing to apply: the generated catalog has FATAL validation ' +
        'errors (see report above). Fix or re-translate first.',
    );
    process.exit(1);
  }

  // Re-serialize through the catalog writer so ar-EG.json keeps the repo's
  // formatting (2-space indent + trailing newline).
  writeCatalog(AR_PATH, readCatalog(AR_GENERATED_PATH));
  rmSync(AR_GENERATED_PATH);

  console.log(
    `\nApplied: overwrote ${AR_PATH} and removed the generated file. ` +
      'Review the git diff, then commit.',
  );
}

main();
