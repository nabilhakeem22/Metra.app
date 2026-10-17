// `npm run market:catalogue`: writes <staging>/catalogue.json (read-only query).
import { parseArgs } from 'node:util';
import { readCatalogue } from '../catalogue';
import { withDatabase } from '../db/connection';
import { cataloguePath, jsonBytes, writeText } from '../staging';

export async function catalogueCommand(argv: string[]): Promise<number> {
  parseArgs({ args: argv, options: {}, strict: true });
  const items = await withDatabase(readCatalogue);
  const path = cataloguePath();
  writeText(path, jsonBytes({ format: 'metra.market-catalogue.v1', items }));
  console.log(`market:catalogue wrote ${items.length} item(s) to ${path}`);
  return 0;
}
