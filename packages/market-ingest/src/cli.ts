// The market CLI: `npm run market:<command> -- ...` from the repo root.
// Every failure prints `market:<command> FAILED: <reason>` and exits 1.
import { catalogueCommand } from './commands/catalogue-command';
import { checkCommand } from './commands/check-command';
import { publishCommand } from './commands/publish-command';
import { rebuildSeedBookCommand } from './commands/rebuild-seed-book-command';
import { reviewCommand } from './commands/review-command';
import { seedCommand } from './commands/seed-command';
import { withdrawCommand } from './commands/withdraw-command';
import { guardDriverWriteAfterClose } from './db/driver-close-guard';

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  catalogue: catalogueCommand,
  check: checkCommand,
  publish: publishCommand,
  'rebuild-seed-book': rebuildSeedBookCommand,
  review: reviewCommand,
  'seed-price-books': seedCommand,
  withdraw: withdrawCommand,
};

async function main(): Promise<number> {
  const [command, ...argv] = process.argv.slice(2);
  const run = command === undefined ? undefined : COMMANDS[command];
  if (run === undefined) {
    console.error(`market FAILED: unknown command "${command ?? ''}"; expected one of ${Object.keys(COMMANDS).join(', ')}`);
    return 1;
  }
  try {
    return await run(argv);
  } catch (error) {
    console.error(`market:${command} FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

guardDriverWriteAfterClose();
main().then((code) => process.exit(code));
