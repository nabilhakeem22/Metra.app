// The market CLI: `npm run market:<command> -- ...` from the repo root.
// Every failure prints `market:<command> FAILED: <reason>` and exits 1.
import { checkCommand } from './commands/check-command';

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  check: checkCommand,
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

main().then((code) => process.exit(code));
