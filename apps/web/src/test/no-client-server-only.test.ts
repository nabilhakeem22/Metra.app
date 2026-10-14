import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loadSourceGraph, SRC_ROOT, srcRelative } from '@/test/source-graph';

// AC 36: a client component never reaches server-only code, so `unexpectedFailure`
// (which logs) stays on the server and the browser bundle carries no driver.

const graph = loadSourceGraph();

/** The value imports of one module that only a server may load. */
function serverOnlyImports(path: string): string[] {
  return graph.files.get(path)!.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    if (statement.importClause?.isTypeOnly) return [];
    const specifier = statement.moduleSpecifier.text;
    return specifier === 'server-only' || specifier === '@metra/db' ? [specifier] : [];
  });
}

describe('no client component reaches server-only code (AC 36)', () => {
  const clientModules = [...graph.files.keys()].filter((path) => graph.directiveOf(path) === 'use client');

  it.each(clientModules.map(srcRelative))('%s', (file) => {
    const seen = new Set<string>();
    const pending = [join(SRC_ROOT, file)];
    const reached: string[] = [];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      // A server action module is an RPC reference in the client bundle, not its code.
      if (graph.directiveOf(path) === 'use server') continue;
      const relative = srcRelative(path);
      if (relative === 'lib/actions/unexpected.ts') reached.push(relative);
      for (const specifier of serverOnlyImports(path)) reached.push(`${relative} imports ${specifier}`);
      pending.push(...graph.importsOf(path));
    }
    expect(reached).toEqual([]);
  });
});
