import ts from 'typescript';

// TEST-ONLY. Finds the places a module BUILDS one of the two failures that tell
// a person nothing they can act on: `generic` and `invalid`. An AST walk, not a
// regex: the regex it replaced (F12) saw only `error: 'generic'` in single
// quotes, and missed double quotes, backticks, `x.error ?? 'generic'`,
// `reason:`, `return 'generic'` and `setError('generic')`.
//
// `generic` is a hit in ANY position that produces a value. Reading one is not:
// a comparison (`=== 'generic'`), a `case`, a literal type, a property NAME, a
// member of a list (`[...].includes(code)`, a set of codes).
// `invalid` is also an ordinary word (a link outcome, a money reader's reason),
// so it is a hit only where a failure is built: an `error:` property, or an
// argument of err / fail / setError.

const FAILURE_BUILDERS = new Set(['err', 'fail', 'setError']);

function isReading(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if (ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent) || ts.isArrayLiteralExpression(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    return op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  }
  return false;
}

function buildsInvalid(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText() === 'error';
  return ts.isCallExpression(parent) && FAILURE_BUILDERS.has(parent.expression.getText());
}

function isBareFailure(node: ts.Node): node is ts.StringLiteralLike {
  if (!ts.isStringLiteralLike(node) || isReading(node)) return false;
  if (node.text === 'generic') return true;
  return node.text === 'invalid' && buildsInvalid(node);
}

/** `line: text` for every bare failure `file` builds. */
export function bareFailures(file: ts.SourceFile): string[] {
  const hits: string[] = [];
  const lines = file.getFullText().split(/\r?\n/);
  const visit = (node: ts.Node): void => {
    if (isBareFailure(node)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line;
      hits.push(`${line + 1}: ${lines[line]!.trim()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
