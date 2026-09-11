/**
 * i18n:registers — print how registers.json classifies every message key.
 *
 *   npm run i18n:registers
 *
 * The register decides whether a string is rewritten into Egyptian Arabic or
 * left as فصحى, and a mis-scoped prefix would quietly turn a client's contract
 * page into slang. There is no test harness under scripts/, so this report is
 * the guard: run it after editing registers.json and read the MSA list.
 *
 * Pure-local, no API key.
 */
import { flatten } from './lib/flatten';
import { EN_PATH, readCatalog } from './lib/paths';
import { loadPolicy, registerFor } from './lib/registers';

const flat = flatten(readCatalog(EN_PATH));
const policy = loadPolicy();
const msa: string[] = [];
const eg: string[] = [];
for (const k of Object.keys(flat)) (registerFor(k, policy) === 'msa' ? msa : eg).push(k);
console.log(`EG  (Egyptian, studio-facing)   : ${eg.length}`);
console.log(`MSA (client-facing / documents) : ${msa.length}`);
console.log('\nEvery MSA key, grouped:');
const groups = new Map<string, number>();
for (const k of msa) {
  const g = k.split('.').slice(0, 2).join('.');
  groups.set(g, (groups.get(g) ?? 0) + 1);
}
for (const [g, n] of [...groups].sort()) console.log(`  ${String(n).padStart(4)}  ${g}`);
console.log('\nSpot-checks:');
for (const k of ['delivery.share.title','delivery.hero.greeting','contracts.ack.intro','contracts.title','variations.client.intro','variations.title','proposals.p.accept','proposals.view.title','errors.token_expired','errors.generic','onboarding.title']) {
  if (k in flat) console.log(`  ${registerFor(k, policy).toUpperCase().padEnd(3)}  ${k}`);
}
