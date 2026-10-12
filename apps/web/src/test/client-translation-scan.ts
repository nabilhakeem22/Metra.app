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
  /** The top-level namespace, or null when it is not known statically. */
  namespace: string | null;
  /** The argument as written ('' when there is none). */
  argument: string;
}

const HOOKS = new Set(['useTranslations', 'useMessages']);

/** The top-level namespace of a useTranslations argument, when it is static. */
function topLevelNamespace(argument: ts.Expression | undefined): string | null {
  if (!argument) return null;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text.split('.')[0]!;
  // `delivery.${notice}`: only the part below a literal top level is computed.
  if (ts.isTemplateExpression(argument) && argument.head.text.includes('.')) return argument.head.text.split('.')[0]!;
  return null;
}

function translationCalls(file: ts.SourceFile, path: string): ClientTranslationCall[] {
  const calls: ClientTranslationCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HOOKS.has(node.expression.text)) {
      const hook = node.expression.text as ClientTranslationCall['hook'];
      const [argument] = node.arguments;
      calls.push({
        path,
        hook,
        namespace: hook === 'useTranslations' ? topLevelNamespace(argument) : null,
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
