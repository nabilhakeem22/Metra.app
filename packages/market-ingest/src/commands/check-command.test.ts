import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asJson, bulletin, months, page, row } from '../testing/fixtures';
import { sha256Hex } from '../staging';
import { checkCommand } from './check-command';

let staging: string;

function writeBulletin(value: unknown): void {
  mkdirSync(join(staging, '2026-07'), { recursive: true });
  writeFileSync(join(staging, '2026-07', 'bulletin.json'), JSON.stringify(value));
}

const readOutput = (name: string) => readFileSync(join(staging, '2026-07', name), 'utf8');

beforeEach(() => {
  staging = mkdtempSync(join(tmpdir(), 'market-staging-'));
  vi.stubEnv('MARKET_STAGING_DIR', staging);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(staging, { recursive: true, force: true });
});

describe('market:check --offline', () => {
  it('exits 0 on a clean file and writes check.json and staged.json', async () => {
    writeBulletin(asJson(bulletin()));
    expect(await checkCommand(['--period', '2026-07', '--offline'])).toBe(0);
    const staged = JSON.parse(readOutput('staged.json'));
    expect(staged.items.map((item: { key: string }) => item.key)).toEqual(['raw.steel.rebar']);
    expect(JSON.parse(readOutput('check.json')).counts.F4).toBe(1);
  });

  it.each([
    ['an unsplit merge', months('1596029811')],
    ['an Arabic-Indic digit', months('٣٨٢٠٠')],
    ['a grouped number', months('38,200')],
  ])('exits 1 on %s and keeps the value out of staged.json (AC 9)', async (_label, slots) => {
    writeBulletin(asJson(bulletin({ pages: [page({ rows: [row({ months: slots, verbatimCells: null })] })] })));
    expect(await checkCommand(['--period', '2026-07', '--offline'])).toBe(1);
    // The refused text may appear in a finding's message (the producer must see
    // it), never as data: a blocked staged.json carries no item and no observation.
    const staged = JSON.parse(readOutput('staged.json'));
    expect(staged.blocking.length).toBeGreaterThan(0);
    expect([staged.categories, staged.items, staged.observations, staged.discontinue]).toEqual([[], [], [], []]);
  });

  it('exits 1 on 11 month slots (AC 9)', async () => {
    const file = asJson(bulletin());
    file.pages[0].rows[0].months.pop();
    writeBulletin(file);
    expect(await checkCommand(['--period', '2026-07', '--offline'])).toBe(1);
    expect(JSON.parse(readOutput('check.json')).findings[0].code).toBe('B1');
  });

  it('verifies the PDF hash when the PDF is passed', async () => {
    const pdf = join(staging, 'bulletin.pdf');
    writeFileSync(pdf, 'pdf bytes');
    writeBulletin(asJson(bulletin({ source: { ...bulletin().source, pdfSha256: sha256Hex('pdf bytes') } })));
    expect(await checkCommand(['--period', '2026-07', '--offline', '--pdf', pdf])).toBe(0);
    writeFileSync(pdf, 'other bytes');
    expect(await checkCommand(['--period', '2026-07', '--offline', '--pdf', pdf])).toBe(1);
  });

  it('refuses a missing or malformed period', async () => {
    await expect(checkCommand(['--offline'])).rejects.toThrow('--period YYYY-MM is required');
    await expect(checkCommand(['--period', '2026-7', '--offline'])).rejects.toThrow('--period YYYY-MM');
  });
});
