import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A `refusals` entry names a constraint by STRING. A misspelt or renamed one
// never matches, so the race it was written for silently falls back to the
// logged `generic`. This walks every `refusals: [...]` in the app with the
// TypeScript parser (however it is spelled, across lines) and requires each
// constraint name to occur in a migration.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../..');
const MIGRATIONS = resolve(here, '../../../../../packages/db/migrations');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const parsed = sourceFiles(SRC).map((path) => ({
  path,
  file: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true),
}));

/** Every `const NAME = '...'` in the app, so an entry may name a shared constant. */
function stringConstants(): Map<string, string> {
  const constants = new Map<string, string>();
  for (const { file } of parsed) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        constants.set(node.name.text, node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return constants;
}

interface NamedConstraint { where: string; name: string | null }

function refusalConstraints(): NamedConstraint[] {
  const constants = stringConstants();
  const found: NamedConstraint[] = [];
  for (const { path, file } of parsed) {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'refusals' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const entry of node.initializer.elements) {
          const constraint = ts.isObjectLiteralExpression(entry)
            ? entry.properties.find((p) => p.name?.getText(file) === 'constraint')
            : undefined;
          const value = constraint && ts.isPropertyAssignment(constraint) ? constraint.initializer : undefined;
          const where = `${relative(SRC, path)}:${file.getLineAndCharacterOfPosition(entry.getStart()).line + 1}`;
          if (value && ts.isStringLiteral(value)) found.push({ where, name: value.text });
          else if (value && ts.isIdentifier(value)) found.push({ where, name: constants.get(value.text) ?? null });
          else found.push({ where, name: null });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

const migrationText = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

describe('every refusals constraint exists in a migration (AC 34)', () => {
  const constraints = refusalConstraints();

  it('finds the refusals it is meant to guard', () => {
    expect(constraints.length).toBeGreaterThanOrEqual(3);
  });

  it.each(constraints.map((c) => [c.where, c.name] as const))('%s names %s', (where, name) => {
    expect(name, `${where}: write the constraint as a string literal or a string const`).not.toBeNull();
    expect(migrationText.includes(name!), `${where}: "${name}" is in no migration`).toBe(true);
  });
});
