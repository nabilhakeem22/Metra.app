import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loadSourceGraph, srcRelative } from '@/test/source-graph';

// loggableFailure logs the `message` of a plain Error (S1). That is safe only
// while no message carries data, so a `new Error(...)` whose message is built
// from values (a template with substitutions, or a concatenation) is refused
// anywhere in apps/web/src. Name the place in a fixed string instead. A message
// that interpolates only developer constants (a column name, a binding name)
// says so in a `developer-only:` comment on the line above; test helpers under
// src/test are not product code.

const DEVELOPER_ONLY = /developer-only:/;

function isBuiltMessage(node: ts.Expression): boolean {
  if (ts.isTemplateExpression(node)) return true;
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

function builtErrorMessages(): string[] {
  const found: string[] = [];
  for (const [path, file] of loadSourceGraph().files) {
    if (srcRelative(path).startsWith('test/')) continue;
    const lines = file.getFullText().split(/\r?\n/);
    const marked = (node: ts.Node): boolean => {
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line;
      return DEVELOPER_ONLY.test(lines[line - 1] ?? '') || DEVELOPER_ONLY.test(lines[line] ?? '');
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /Error$/.test(node.expression.text) &&
        node.arguments?.[0] &&
        isBuiltMessage(node.arguments[0]) &&
        !marked(node) &&
        !marked(node.parent)
      ) {
        found.push(`${srcRelative(path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

describe('no Error message is built from values (S1)', () => {
  it('finds none in apps/web/src', () => {
    expect(builtErrorMessages()).toEqual([]);
  });
});
