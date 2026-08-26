/**
 * i18n validation gate — PURE LOCAL, no API key, never calls Gemini.
 *
 *   npm run i18n:validate [-- --file <path>] [--strict]
 *
 * Validates a target Arabic catalog against the English source of truth:
 *   FATAL   parity mismatch, placeholder/tag mismatch, ICU parse failure,
 *           Arabic-Indic digits, empty value.
 *   WARNING plural incompleteness (missing CLDR categories) — becomes FATAL
 *           under --strict.
 *
 * Exits non-zero if any FATAL is found (or any WARNING under --strict).
 */
import { AR_PATH } from './lib/paths';
import { printBucket, validate } from './lib/validator';

function parseArgs(argv: string[]): { file: string; strict: boolean } {
  let file = AR_PATH;
  let strict = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--strict') {
      strict = true;
    } else if (arg === '--file') {
      const next = argv[index + 1];
      if (!next) {
        console.error('--file requires a path argument.');
        process.exit(2);
      }
      file = next;
      index++;
    }
  }
  return { file, strict };
}

function main(): void {
  const { file, strict } = parseArgs(process.argv.slice(2));
  console.log(`i18n:validate — target=${file}${strict ? ' (strict)' : ''}`);

  const report = validate(file, strict);
  const fatalCount = printBucket('FATAL', report.fatal);
  const warningCount = printBucket('WARNING', report.warning);

  console.log(
    `\nSummary: ${fatalCount} fatal, ${warningCount} warning${
      strict ? ' (strict: warnings are fatal)' : ''
    }.`,
  );

  if (fatalCount > 0) {
    console.error('VALIDATION FAILED.');
    process.exit(1);
  }
  console.log('VALIDATION PASSED.');
}

main();
