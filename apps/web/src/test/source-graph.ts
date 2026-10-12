import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// TEST-ONLY. Every source module under apps/web/src, parsed with the
// TypeScript parser, with the modules it loads at RUNTIME (type-only imports
// and exports aside). For the static guards that ask what a module reaches.

export const SRC_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const SOURCE = /\.tsx?$/;
const TEST = /\.(test|dbtest)\.tsx?$/;

export interface SourceGraph {
  /** Absolute path to parsed module. */
  files: ReadonlyMap<string, ts.SourceFile>;
  /** The modules under src that `path` loads at runtime (packages aside). */
  importsOf(path: string): string[];
  /** The file's leading directive ('use client', 'use server'), or null. */
  directiveOf(path: string): string | null;
}

function sourcePaths(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourcePaths(path);
    return SOURCE.test(name) && !TEST.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  const local = specifier.startsWith('@/') || specifier.startsWith('.');
  if (!local) return null;
  const base = specifier.startsWith('@/') ? join(SRC_ROOT, specifier.slice(2)) : resolve(dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function runtimeSpecifiers(file: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

export function loadSourceGraph(): SourceGraph {
  const files = new Map(
    sourcePaths(SRC_ROOT).map((path) => [path, ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)]),
  );
  const imports = new Map<string, string[]>();
  return {
    files,
    importsOf(path) {
      if (!imports.has(path)) {
        const targets = runtimeSpecifiers(files.get(path)!).map((specifier) => resolveImport(path, specifier));
        imports.set(path, targets.filter((target): target is string => target !== null && files.has(target)));
      }
      return imports.get(path)!;
    },
    directiveOf(path) {
      const first = files.get(path)!.statements[0];
      return first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first.expression.text : null;
    },
  };
}

/** `path` relative to src, with '/'. */
export function srcRelative(path: string): string {
  return relative(SRC_ROOT, path).replace(/\\/g, '/');
}
