import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { functionPropsAcrossBoundary, serverComponentModules } from '@/test/server-function-props';
import { loadSourceGraph, SRC_ROOT, srcRelative } from '@/test/source-graph';

// The October hotfix: the project BOQ tab crashed for every project with a BOQ.
// `BoqTab`, a server component, handed `BoqSheet` (a client component) its
// header controls as a render-prop, and Next refuses a function at the boundary
// with "Functions cannot be passed directly to Client Components" — at request
// time, after tsc, lint and every jsdom test had passed. This is the fence: no
// server component passes a function to a client component or a DOM element.

const graph = loadSourceGraph();
const serverModules = serverComponentModules(graph);

const BOQ_DIRECTORY = 'app/[locale]/(app)/projects/[id]';

/** A probe file placed beside the BOQ tab, so its relative imports resolve to the real modules. */
function scanProbe(source: string): string[] {
  const path = join(SRC_ROOT, BOQ_DIRECTORY, 'probe.tsx');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return functionPropsAcrossBoundary(graph, path, file).map(({ element, prop, value }) => `<${element} ${prop}> ${value}`);
}

describe('server components pass no function to a client component', () => {
  it('finds the routes’ server components, the BOQ tab among them', () => {
    expect(serverModules.length).toBeGreaterThan(50);
    expect(serverModules.map(srcRelative)).toContain(`${BOQ_DIRECTORY}/boq-tab.tsx`);
    expect(serverModules.map(srcRelative)).not.toContain(`${BOQ_DIRECTORY}/boq-tab-sheet.tsx`);
  });

  it('none passes a function across the boundary', () => {
    const found = serverModules.flatMap((path) => functionPropsAcrossBoundary(graph, path, graph.files.get(path)!));
    expect(found.map(({ path, line, element, prop, value }) => `${path}:${line} <${element} ${prop}> ${value}`)).toEqual([]);
  });
});

describe('the boundary scan', () => {
  it('catches the BOQ tab as it shipped: a render-prop to BoqSheet', () => {
    const source = `
      import { BoqSheet } from './boq-sheet';
      export function BoqTab({ boq }) {
        return <BoqSheet boq={boq} canEdit actions={(shown) => <span>{shown.lineCount}</span>} />;
      }`;
    expect(scanProbe(source)).toEqual(['<BoqSheet actions> an inline function']);
  });

  it('catches a function by name, declared here or imported from a module of ours', () => {
    const source = `
      import { BoqSheet } from './boq-sheet';
      import { withoutLines } from '@/lib/boqs/without-lines';
      function render() { return null; }
      const later = () => null;
      export const A = () => <BoqSheet boq={1} canEdit actions={render} />;
      export const B = () => <BoqSheet boq={1} canEdit actions={later} />;
      export const C = () => <BoqSheet boq={1} canEdit actions={withoutLines} />;`;
    expect(scanProbe(source)).toEqual([
      '<BoqSheet actions> local function render',
      '<BoqSheet actions> local function later',
      '<BoqSheet actions> imported function withoutLines',
    ]);
  });

  it('looks through a condition, an object and a render-prop child', () => {
    const source = `
      import { BoqSheet } from './boq-sheet';
      export const A = ({ on }) => <BoqSheet boq={1} canEdit actions={on ? () => null : undefined} />;
      export const B = () => <BoqSheet boq={{ format() { return ''; } }} canEdit />;
      export const C = () => <BoqSheet boq={1} canEdit>{(x) => x}</BoqSheet>;`;
    expect(scanProbe(source)).toEqual([
      '<BoqSheet actions> an inline function',
      '<BoqSheet boq> a method in an object',
      '<BoqSheet children> an inline function',
    ]);
  });

  it('catches an event handler on a DOM element rendered by a server component', () => {
    expect(scanProbe('export const A = () => <button onClick={() => {}}>x</button>;')).toEqual([
      '<button onClick> an inline function',
    ]);
  });

  it('lets through data, server actions, and functions handed to a server component', () => {
    const source = `
      import { BoqSheet } from './boq-sheet';
      import { issueBoq } from '@/lib/boqs/actions';
      import { BoqTab } from './boq-tab';
      export const A = ({ boq }) => <BoqSheet boq={boq} canEdit={boq.status === 'draft'} />;
      export const B = () => <form action={issueBoq} />;
      export const C = () => <form action={async () => { 'use server'; }} />;
      export const D = () => <BoqTab render={() => null} />;
      export const E = ({ rows }) => <BoqSheet boq={rows.map((row) => row.id)} canEdit />;`;
    expect(scanProbe(source)).toEqual([]);
  });
});
