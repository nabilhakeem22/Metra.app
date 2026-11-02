import { describe, expect, it } from 'vitest';
import { loadSourceGraph, srcRelative } from '@/test/source-graph';

// The invariant "a pair has one delivery" holds because the app has exactly two
// places that insert one, under one lock (./delivery-slot.ts, lib/client-home/ensure.ts):
// a third would silently lose it, since no index backs it. And the rule costs reads
// only where the plan says (AC21): the client home and the cockpit never ask it.

const graph = loadSourceGraph();
const productionFiles = [...graph.files.entries()].map(([path, file]) => ({
  path: srcRelative(path).replace(/\\/g, '/'),
  text: file.getFullText(),
}));

const filesContaining = (needle: string) => productionFiles.filter(({ text }) => text.includes(needle)).map(({ path }) => path).sort();

describe('the one-delivery invariant', () => {
  it('has exactly two insert sites', () => {
    expect(filesContaining('.insert(designEngagements)')).toEqual(['lib/client-home/ensure.ts', 'lib/engagements/core.ts']);
  });

  it('the cap and the extension are gone', () => {
    for (const name of ['PROJECT_DELIVERY_CAP', 'countProjectDeliveries', 'deliveriesCountedTowardCap', 'project_delivery_limit_reached', 'delivery_not_in_execution']) {
      expect(filesContaining(name), name).toEqual([]);
    }
  });
});

describe('who reads the gate (AC21)', () => {
  it('the cores, and the BOQ tab; never the client home or the cockpit', () => {
    expect(filesContaining("from '@/lib/engagements/pair-home'")).toEqual([
      'app/[locale]/(app)/projects/[id]/boq-tab-data.ts',
      'lib/boqs/core/start-version.ts',
      'lib/client-home/ensure.ts',
      'lib/contracts/core/create-from-boq.ts',
      'lib/contracts/core/create.ts',
      'lib/contracts/lifecycle/issue.ts',
      'lib/contracts/lifecycle/sign-offline.ts',
    ]);
  });
});
