import { describe, expect, it } from 'vitest';
import { loadSourceGraph, srcRelative } from '@/test/source-graph';

// Four modules export writes and reads WITHOUT the guards that admit them: the
// capability, the validation, the founding order and the transaction all stay in
// the core that calls them. Each is safe because exactly one core reaches it,
// after its own checks and inside its own transaction. A second importer would
// write a studio's rows, claim a project code, record a price change or insert
// cost items with none of them, and nothing else would say so.
//
// What is counted is what a module LOADS: a static import, a re-export or a
// dynamic import, by alias or by relative path, resolved to the file. A
// type-only import carries no function and is not counted
// (bulk-history.ts takes the BulkRow type from bulk-apply.ts and the PriceTarget
// type from bulk-core.ts). Test files are not source and are not walked.

const ONLY_IMPORTER_OF = {
  'lib/org/founding-writes.ts': 'lib/org/core.ts',
  'lib/projects/core/create-phases.ts': 'lib/projects/core/create.ts',
  'lib/price-book/bulk-history.ts': 'lib/price-book/bulk-core.ts',
  'lib/price-book/import-rows.ts': 'lib/price-book/import-core.ts',
} as const;

const graph = loadSourceGraph();
const productionPaths = [...graph.files.keys()];

const importersOf = (module: string) =>
  productionPaths
    .filter((path) => graph.importsOf(path).some((loaded) => srcRelative(loaded) === module))
    .map(srcRelative)
    .sort();

describe('the write-phase helpers have one importer each', () => {
  it.each(Object.entries(ONLY_IMPORTER_OF))('%s is loaded by %s and by nothing else', (module, core) => {
    expect(productionPaths.map(srcRelative)).toContain(module);
    expect(importersOf(module)).toEqual([core]);
  });
});
