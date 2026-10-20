import { basename, join, sep } from 'node:path';
import ts from 'typescript';
import { resolveImport, SRC_ROOT, srcRelative, type SourceGraph } from './source-graph';

// TEST-ONLY. Where a SERVER component hands a FUNCTION to a client component or
// to a DOM element — the prop React cannot serialise. Next refuses the whole
// render at request time ("Functions cannot be passed directly to Client
// Components"), and nothing before that notices: tsc, lint and a jsdom render
// all run the tree as one process, where a function prop is just a prop. That
// is how the BOQ tab shipped crashing for every project that had a BOQ.
//
// WHICH MODULES ARE SERVER COMPONENTS is decided the way Next decides it: from
// the route's own files (page, layout, …), following imports until a
// 'use client' module (the boundary) or a 'use server' one (an RPC reference).
// A file without a directive is not a server component by itself — one imported
// only from client code is client code.
//
// WHAT COUNTS AS A FUNCTION, by its syntax: an inline arrow or function, a
// method in an object literal, or a name bound to one — declared in the file or
// exported by a module of ours — looked through `cond ? a : b`, `a && b`,
// object and array literals. A server action ('use server' module or body) is
// a reference, not a function, and passes.
//
// OUT OF REACH, and so for review: a value whose kind is not visible in the
// syntax (a parameter forwarded on, a call's result, a spread), and client
// components from PACKAGES (next/link, Radix), whose boundary is in node_modules.

/** One function prop a server component passes across the boundary. */
export interface FunctionPropAcrossBoundary {
  /** Relative to src, with '/'. */
  path: string;
  line: number;
  /** The element as written (`BoqSheet`, `button`). */
  element: string;
  /** The prop (`actions`), or 'children' for a render-prop child. */
  prop: string;
  /** Why the value is a function ('an inline function', 'local function render'). */
  value: string;
}

/** Next's special files a route renders on the server unless marked 'use client'. */
const ROUTE_FILE = /^(page|layout|template|loading|not-found|default|forbidden|unauthorized)\.tsx?$/;

function filesUnder(graph: SourceGraph, directory: string): string[] {
  return [...graph.files.keys()].filter((path) => path.startsWith(directory + sep));
}

/** Every module rendered as a server component by some route. */
export function serverComponentModules(graph: SourceGraph): string[] {
  const entries = filesUnder(graph, join(SRC_ROOT, 'app')).filter((path) => ROUTE_FILE.test(basename(path)));
  const server = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (server.has(path)) continue;
    const directive = graph.directiveOf(path);
    if (directive === 'use client' || directive === 'use server') continue;
    server.add(path);
    pending.push(...graph.importsOf(path));
  }
  return [...server].sort();
}

function hasUseServerDirective(body: ts.Node | undefined): boolean {
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server';
}

/** The module and exported name a local name is imported as, if it is imported. */
function importOf(file: ts.SourceFile, localName: string): { specifier: string; exported: string } | null {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (clause.name?.text === localName) return { specifier, exported: 'default' };
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === localName) return { specifier, exported: '*' };
    if (bindings && ts.isNamedImports(bindings)) {
      const element = bindings.elements.find((candidate) => candidate.name.text === localName);
      if (element && !element.isTypeOnly) return { specifier, exported: (element.propertyName ?? element.name).text };
    }
  }
  return null;
}

/** The modules an `export … from` in `path` forwards `name` to. */
function reExportTargets(graph: SourceGraph, path: string, name: string): { path: string; name: string }[] {
  return graph.files.get(path)!.statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) return [];
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const target = resolveImport(path, statement.moduleSpecifier.text);
    if (!target || !graph.files.has(target)) return [];
    const clause = statement.exportClause;
    if (!clause) return name === 'default' ? [] : [{ path: target, name }];
    if (!ts.isNamedExports(clause)) return [];
    const element = clause.elements.find((candidate) => candidate.name.text === name);
    return element ? [{ path: target, name: (element.propertyName ?? element.name).text }] : [];
  });
}

/** Whether `name` exported from `path` is code that runs in the browser. */
function isClientExport(graph: SourceGraph, path: string, name: string, depth = 0): boolean {
  if (graph.directiveOf(path) === 'use client') return true;
  if (depth > 8) return false;
  return reExportTargets(graph, path, name).some((target) => isClientExport(graph, target.path, target.name, depth + 1));
}

/** The top-level declaration of `name` in `file` (function, or const with an initialiser). */
function declarationOf(file: ts.SourceFile, name: string): ts.FunctionDeclaration | ts.Expression | null {
  let found: ts.FunctionDeclaration | ts.Expression | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The local name `path` exports as `exported` (`export { local as exported }`), or `exported`. */
function localNameOfExport(file: ts.SourceFile, exported: string): string {
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const element = statement.exportClause.elements.find((candidate) => candidate.name.text === exported);
    if (element) return (element.propertyName ?? element.name).text;
  }
  return exported;
}

interface ScanContext {
  graph: SourceGraph;
  path: string;
  file: ts.SourceFile;
  depth: number;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Why a declaration is a function that is not a server action, or null. */
function functionDeclarationReason(declaration: ts.FunctionDeclaration | ts.Expression, context: ScanContext, label: string): string | null {
  if (ts.isFunctionDeclaration(declaration)) {
    const inServerActionModule = context.graph.files.has(context.path) && context.graph.directiveOf(context.path) === 'use server';
    if (hasUseServerDirective(declaration.body) || inServerActionModule) return null;
    return label;
  }
  return functionReason(declaration, { ...context, depth: context.depth + 1 }) === null ? null : label;
}

/** Why the value an imported name carries is a function, or null. */
function importedFunctionReason(name: string, context: ScanContext): string | null {
  const imported = importOf(context.file, name);
  if (!imported || imported.exported === '*') return null;
  const target = resolveImport(context.path, imported.specifier);
  if (!target || !context.graph.files.has(target)) return null;
  if (context.graph.directiveOf(target) === 'use server') return null;
  const targetFile = context.graph.files.get(target)!;
  const declaration = imported.exported === 'default' ? null : declarationOf(targetFile, localNameOfExport(targetFile, imported.exported));
  if (!declaration) return null;
  return functionDeclarationReason(declaration, { ...context, path: target, file: targetFile }, `imported function ${name}`);
}

/** Why `expression` evaluates to a function a server cannot send, or null. */
function functionReason(expression: ts.Expression, context: ScanContext): string | null {
  if (context.depth > 6) return null;
  const value = unwrap(expression);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return hasUseServerDirective(value.body) ? null : 'an inline function';
  }
  if (ts.isConditionalExpression(value)) return functionReason(value.whenTrue, context) ?? functionReason(value.whenFalse, context);
  if (ts.isBinaryExpression(value)) {
    const operator = value.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return functionReason(value.right, context);
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      return functionReason(value.left, context) ?? functionReason(value.right, context);
    }
    return null;
  }
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
        return 'a method in an object';
      }
      const inner = ts.isPropertyAssignment(property)
        ? functionReason(property.initializer, context)
        : ts.isShorthandPropertyAssignment(property)
          ? functionReason(property.name, context)
          : null;
      if (inner) return `${inner} inside an object`;
    }
    return null;
  }
  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      const inner = ts.isSpreadElement(element) ? null : functionReason(element, context);
      if (inner) return `${inner} inside an array`;
    }
    return null;
  }
  if (ts.isIdentifier(value)) {
    const local = declarationOf(context.file, value.text);
    if (local) return functionDeclarationReason(local, context, `local function ${value.text}`);
    return importedFunctionReason(value.text, context);
  }
  return null;
}

/** The element a JSX tag names, when React would serialise its props: a DOM
 *  element, or a component exported by a 'use client' module of ours. */
function crossesBoundary(tag: ts.JsxTagNameExpression, context: ScanContext): boolean {
  if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) return true;
  const root = ts.isPropertyAccessExpression(tag) ? tag.expression : tag;
  if (!ts.isIdentifier(root)) return false;
  const imported = importOf(context.file, root.text);
  if (!imported) return false;
  const target = resolveImport(context.path, imported.specifier);
  if (!target || !context.graph.files.has(target)) return false;
  if (imported.exported === '*') return context.graph.directiveOf(target) === 'use client';
  return isClientExport(context.graph, target, imported.exported);
}

/** Every function prop `file` (a server component module) passes across the boundary. */
export function functionPropsAcrossBoundary(graph: SourceGraph, path: string, file: ts.SourceFile): FunctionPropAcrossBoundary[] {
  const context: ScanContext = { graph, path, file, depth: 0 };
  const found: FunctionPropAcrossBoundary[] = [];
  const report = (node: ts.Node, element: ts.JsxTagNameExpression, prop: string, value: string) => {
    found.push({
      path: srcRelative(path),
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      element: element.getText(file),
      prop,
      value,
    });
  };
  const checkAttributes = (element: ts.JsxOpeningLikeElement) => {
    for (const attribute of element.attributes.properties) {
      if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) continue;
      const expression = attribute.initializer.expression;
      const reason = expression ? functionReason(expression, context) : null;
      if (reason) report(attribute, element.tagName, attribute.name.getText(file), reason);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && crossesBoundary(node.tagName, context)) checkAttributes(node);
    if (ts.isJsxElement(node) && crossesBoundary(node.openingElement.tagName, context)) {
      checkAttributes(node.openingElement);
      for (const child of node.children) {
        const reason = ts.isJsxExpression(child) && child.expression ? functionReason(child.expression, context) : null;
        if (reason) report(child, node.openingElement.tagName, 'children', reason);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
