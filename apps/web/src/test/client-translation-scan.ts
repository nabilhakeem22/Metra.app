import ts from 'typescript';
import { srcRelative, type SourceGraph } from './source-graph';

// TEST-ONLY. Which message namespaces a part of the app needs IN THE BROWSER.
// Walking the imports from a route's files, a module reached through a
// 'use client' file is part of the client bundle, so its useTranslations calls
// read the messages NextIntlClientProvider was handed. Before that boundary the
// modules are server components, which read the full catalogue on the server
// (getTranslations, or useTranslations in a server component) and send none of
// it. A 'use server' file is the server's: its imports are not the client's.

/** One useTranslations or useMessages call in client code. */
export interface ClientTranslationCall {
  /** Relative to src, with '/'. */
  path: string;
  hook: 'useTranslations' | 'useMessages';
  /** The namespace as far as it is static ('proposals.p', or 'delivery' for
   *  `delivery.${notice}`), or null when not even its top level is. */
  namespace: string | null;
  /** The argument as written ('' when there is none). */
  argument: string;
}

const HOOKS = new Set(['useTranslations', 'useMessages']);
const INTL_PACKAGES = new Set(['next-intl', 'use-intl']);

/**
 * How this file can name the hooks (Round E F4): the local name of each hook it
 * imports from next-intl (an alias included: `useTranslations as useT`), and
 * the names it imports the whole package under (`import * as intl`). OUT OF
 * REACH, and so refused by review rather than this scan: a hook re-exported
 * under another name by a module of our own, or passed around as a value.
 */
function hookBindings(file: ts.SourceFile): { hooks: Map<string, ClientTranslationCall['hook']>; packages: Set<string> } {
  const hooks = new Map<string, ClientTranslationCall['hook']>();
  const packages = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!INTL_PACKAGES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) packages.add(bindings.name.text);
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (HOOKS.has(imported)) hooks.set(element.name.text, imported as ClientTranslationCall['hook']);
    }
  }
  return { hooks, packages };
}

/** The hook a call invokes, when its callee is one of the file's hook bindings. */
function calledHook(callee: ts.Expression, bindings: ReturnType<typeof hookBindings>): ClientTranslationCall['hook'] | null {
  if (ts.isIdentifier(callee)) return bindings.hooks.get(callee.text) ?? null;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && bindings.packages.has(callee.expression.text)) {
    return HOOKS.has(callee.name.text) ? (callee.name.text as ClientTranslationCall['hook']) : null;
  }
  return null;
}

/** The static part of a useTranslations namespace: all of a literal, or a
 *  template's literal head up to its last dot (`delivery.hero.${group}` reads
 *  'delivery.hero'). Null when not even the top level is literal. */
function staticNamespace(argument: ts.Expression | undefined): string | null {
  if (!argument) return null;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  if (ts.isTemplateExpression(argument) && argument.head.text.includes('.')) {
    return argument.head.text.slice(0, argument.head.text.lastIndexOf('.'));
  }
  return null;
}

/** Every useTranslations / useMessages call in one file, however it names them. */
export function translationCalls(file: ts.SourceFile, path: string): ClientTranslationCall[] {
  const bindings = hookBindings(file);
  const calls: ClientTranslationCall[] = [];
  const visit = (node: ts.Node) => {
    const hook = ts.isCallExpression(node) ? calledHook(node.expression, bindings) : null;
    if (hook && ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      calls.push({
        path,
        hook,
        namespace: hook === 'useTranslations' ? staticNamespace(argument) : null,
        argument: argument ? argument.getText(file) : '',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

/** The modules that run in the browser when the `entries` render. */
export function clientModulesReachedFrom(graph: SourceGraph, entries: readonly string[]): string[] {
  const client = new Set<string>();
  const server = new Set<string>();
  const pending = entries.map((path) => ({ path, inClient: false }));
  while (pending.length > 0) {
    const { path, inClient: reachedFromClient } = pending.pop()!;
    const directive = graph.directiveOf(path);
    if (reachedFromClient && directive === 'use server') continue;
    const inClient = reachedFromClient || directive === 'use client';
    const seen = inClient ? client : server;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const target of graph.importsOf(path)) pending.push({ path: target, inClient });
  }
  return [...client].sort();
}

/** Every useTranslations / useMessages call in the client modules the `entries` reach. */
export function clientTranslationCalls(graph: SourceGraph, entries: readonly string[]): ClientTranslationCall[] {
  return clientModulesReachedFrom(graph, entries).flatMap((path) => translationCalls(graph.files.get(path)!, srcRelative(path)));
}
