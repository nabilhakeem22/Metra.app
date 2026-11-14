import { describe, expect, it } from 'vitest';
import { loadSourceGraph, srcRelative } from '@/test/source-graph';

// Five modules export a WRITE without the guards that admit it: the capability,
// the flow, the engagement's state, the claim's lock and status all stay in the
// core that calls them. Each write is safe because exactly one core reaches it,
// after its own checks. A second importer would append to the ledger, record
// money or flip a claim with none of them, and nothing else would say so.
//
// What is counted is what a module LOADS: a static import, a re-export or a
// dynamic import, by alias or by relative path, resolved to the file. A
// type-only import carries no function and is not counted
// (payment-claim-ledger.ts takes the LockedClaim type from payment-claim-rows.ts).
// Test files are not source and are not walked.

const ONLY_IMPORTER_OF = {
  'lib/engagements/rom-band-writes.ts': 'lib/engagements/rom.ts',
  'lib/engagements/payment-claim-ledger.ts': 'lib/engagements/payment-claims.ts',
  'lib/engagements/payment-claim-rows.ts': 'lib/engagements/payment-claims.ts',
  'lib/engagements/event-correction-ledger.ts': 'lib/engagements/corrections.ts',
  'lib/engagements/rom-acknowledgement-ledger.ts': 'lib/engagements/rom-acknowledgement.ts',
} as const;

const graph = loadSourceGraph();
const productionPaths = [...graph.files.keys()];

const importersOf = (module: string) =>
  productionPaths
    .filter((path) => graph.importsOf(path).some((loaded) => srcRelative(loaded) === module))
    .map(srcRelative)
    .sort();

describe('the ledger write helpers have one importer each', () => {
  it.each(Object.entries(ONLY_IMPORTER_OF))('%s is loaded by %s and by nothing else', (module, core) => {
    expect(productionPaths.map(srcRelative)).toContain(module);
    expect(importersOf(module)).toEqual([core]);
  });
});
