import ts from 'typescript';

// TEST-ONLY. Finds a failure TOAST (not a destructive confirm dialog, which asks
// before acting): a `toast(...)` call whose argument carries
// `variant: 'destructive'` at any depth, however the string is quoted. A regex
// over the text missed double quotes, backticks and a nested object before the
// variant (F12).

function carriesDestructive(node: ts.Node): boolean {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText() === 'variant' &&
    ts.isStringLiteralLike(node.initializer) &&
    node.initializer.text === 'destructive'
  ) {
    return true;
  }
  return ts.forEachChild(node, (child) => carriesDestructive(child) || undefined) ?? false;
}

/** How many destructive toasts `file` raises. */
export function destructiveToasts(file: ts.SourceFile): number {
  let found = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'toast' && node.arguments.some(carriesDestructive)) {
      found += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
