// Test-only: run the pure check on fixture files without touching the disk.
import { EMPTY_HISTORY, type PublishedHistory } from '../check/context';
import { runCheck, type CheckOutcome } from '../check/run';
import type { Finding } from '../findings';
import type { MarketBulletinFileV1 } from '../format';
import { asJson } from './fixtures';

export interface FixtureRun {
  mapping?: unknown;
  corrections?: unknown;
  history?: PublishedHistory;
  period?: string;
  parts?: MarketBulletinFileV1[];
}

export function checkFixture(file: MarketBulletinFileV1 | null, options: FixtureRun = {}): CheckOutcome {
  const producerFiles = options.parts
    ? options.parts.map((part, index) => ({ name: `parts/part-${index + 1}.json`, value: asJson(part) }))
    : [{ name: 'bulletin.json', value: asJson(file) }];
  return runCheck({
    period: options.period ?? file?.period ?? options.parts?.[0]?.period ?? '2026-07',
    producerFiles,
    mapping: options.mapping,
    corrections: options.corrections,
    history: options.history ?? EMPTY_HISTORY,
    historyValidators: [],
    flagPct: 15,
    sourceHashes: { pdf: null, md: null },
    gateCommit: null,
  });
}

/** Findings as compact `code rowId month` strings, F4 (every item is new offline) left out. */
export function brief(outcome: CheckOutcome, options: { keepNewItems?: boolean } = {}): string[] {
  return outcome.findings
    .filter((item: Finding) => options.keepNewItems || item.code !== 'F4')
    .map((item) => [item.code, item.rowId ?? `page ${item.page ?? '-'}`, item.month ? `m${item.month}` : ''].join(' ').trim());
}
