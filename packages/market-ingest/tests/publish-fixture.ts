// Shared set-up for the publish DB tests: a staging folder, a stand-in PDF
// whose hash the bulletin names, a two-row bulletin, and the commands. The
// gate's git probe is mocked by each test file (vi.mock('../src/gate')).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCommand } from '../src/commands/check-command';
import { publishCommand } from '../src/commands/publish-command';
import type { MarketBulletinFileV1 } from '../src/format';
import { sha256Hex } from '../src/staging';
import { asJson, bulletin, months, page, printedCells, row } from '../src/testing/fixtures';
import { REVIEWER } from './db-fixture';

export const GATE_COMMIT = 'f'.repeat(40);

export interface Staging {
  dir: string;
}

export function newStaging(): Staging {
  return { dir: mkdtempSync(join(tmpdir(), 'market-publish-')) };
}

/** A stand-in PDF per period: one PDF published for two periods is B11. */
function pdfFor(staging: Staging, period: string): string {
  const path = join(staging.dir, `bulletin-${period}.pdf`);
  writeFileSync(path, `the ${period} bulletin PDF, as received`);
  return path;
}

export interface FileOptions {
  period?: string;
  price?: string;
  labelAr?: string;
  nameEn?: string;
  withWire?: boolean;
}

/** A rebar row and (by default) a 100 m roll of wire, read from the stand-in PDF. */
export function bulletinFile(staging: Staging, options: FileOptions = {}): MarketBulletinFileV1 {
  const period = options.period ?? '2004-07';
  const upTo = (values: string[]) => values.slice(0, Number(period.slice(5)));
  const price = options.price ?? '39850';
  const slots = months(...upTo(['38200', '38200', '38200', price, price, price, price]));
  const roll = months(...upTo(['2050', '2050', '2050', '2050', '2050', '2050', '2100']));
  const rebar = row({ proposedKey: 'raw.steel.dbtest_rebar', months: slots, verbatimCells: printedCells(slots), labelAr: options.labelAr ?? 'حديد التسليح', nameEn: options.nameEn ?? 'Reinforcing steel' });
  const wire = row({ rowId: 'p2.r2', proposedKey: 'raw.steel.dbtest_wire', labelAr: 'سلك', unitLabelAr: 'اللفة (100 م.ط)', months: roll, verbatimCells: printedCells(roll) });
  const rows = options.withWire === false ? [rebar] : [rebar, wire];
  return bulletin({
    period,
    source: { ...bulletin().source, pdfSha256: sha256Hex(readFileSync(pdfFor(staging, period))) },
    pages: [page({ yearly: null, defaultUnitLabelAr: null, legendLabelsAr: rows.map((item) => item.labelAr), rows })],
  });
}

export function periodDir(staging: Staging, period: string): string {
  return join(staging.dir, period);
}

/** Write the producer file (and any overrides), run the check, return the staged hash. */
export async function stage(staging: Staging, value: unknown, options: { period?: string; offline?: boolean; mapping?: unknown } = {}): Promise<string> {
  const period = options.period ?? (value as MarketBulletinFileV1).period;
  mkdirSync(periodDir(staging, period), { recursive: true });
  writeFileSync(join(periodDir(staging, period), 'bulletin.json'), JSON.stringify(asJson(value)));
  if (options.mapping !== undefined) writeFileSync(join(periodDir(staging, period), 'mapping.json'), JSON.stringify(options.mapping));
  await checkCommand(['--period', period, '--pdf', pdfFor(staging, period), ...(options.offline ? ['--offline'] : [])]);
  return sha256Hex(readFileSync(join(periodDir(staging, period), 'staged.json')));
}

export function publish(staging: Staging, period: string, approve: string, extra: string[] = []): Promise<number> {
  return publishCommand(['--period', period, '--approve', approve, '--reviewer', REVIEWER, '--pdf', pdfFor(staging, period), ...extra]);
}
