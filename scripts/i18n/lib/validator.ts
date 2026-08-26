/**
 * Core i18n validation logic, decoupled from the CLI so it can be reused by
 * both `validate.ts` (the gate) and `apply.ts` (the promote step). No process
 * exit, no argument parsing here — callers own those.
 */
import { flatten } from './flatten';
import {
  collectArgumentNames,
  collectPluralNodes,
  collectTagNames,
  missingArabicPluralCategories,
  parseMessage,
} from './icu';
import { EN_PATH, readCatalog } from './paths';

export type Finding = { key: string; detail: string };

export type Report = {
  fatal: Record<string, Finding[]>;
  warning: Record<string, Finding[]>;
};

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

function addFinding(
  bucket: Record<string, Finding[]>,
  category: string,
  finding: Finding,
): void {
  (bucket[category] ??= []).push(finding);
}

function record(
  report: Report,
  strict: boolean,
  category: string,
  finding: Finding,
): void {
  addFinding(strict ? report.fatal : report.warning, category, finding);
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function describeSetDiff(en: Set<string>, ar: Set<string>): string {
  const missing = [...en].filter((name) => !ar.has(name));
  const extra = [...ar].filter((name) => !en.has(name));
  const parts: string[] = [];
  if (missing.length) parts.push(`missing in ar: {${missing.join(', ')}}`);
  if (extra.length) parts.push(`extra in ar: {${extra.join(', ')}}`);
  return parts.join('; ');
}

/**
 * Validate `targetPath` (an Arabic catalog) against the English source. When
 * `strict` is true, plural-completeness findings are FATAL; otherwise they are
 * WARNINGs. All other checks are always FATAL.
 */
export function validate(targetPath: string, strict: boolean): Report {
  const report: Report = { fatal: {}, warning: {} };
  const en = flatten(readCatalog(EN_PATH));
  const ar = flatten(readCatalog(targetPath));

  const enKeys = Object.keys(en);
  const arKeySet = new Set(Object.keys(ar));
  const enKeySet = new Set(enKeys);

  // 1. Parity.
  for (const key of enKeys) {
    if (!arKeySet.has(key)) {
      addFinding(report.fatal, 'parity: missing in ar', {
        key,
        detail: 'present in en, absent in ar',
      });
    }
  }
  for (const key of Object.keys(ar)) {
    if (!enKeySet.has(key)) {
      addFinding(report.fatal, 'parity: extra in ar', {
        key,
        detail: 'present in ar, absent in en',
      });
    }
  }

  // Per-value checks only for keys present in both.
  for (const key of enKeys) {
    if (!arKeySet.has(key)) continue;
    const enValue = en[key];
    const arValue = ar[key];

    // 2. Empty / whitespace-only.
    if (arValue.trim() === '') {
      addFinding(report.fatal, 'empty value', {
        key,
        detail: 'ar value is empty or whitespace-only',
      });
      continue;
    }

    // 3. Arabic-Indic digits.
    if (ARABIC_INDIC_DIGITS.test(arValue)) {
      addFinding(report.fatal, 'arabic-indic digits', {
        key,
        detail: `ar value contains Arabic-Indic digits: "${arValue}"`,
      });
    }

    // 4. ICU parse of both sides.
    let enAst;
    let arAst;
    try {
      enAst = parseMessage(enValue);
    } catch (error) {
      addFinding(report.fatal, 'icu parse (en source)', {
        key,
        detail: (error as Error).message,
      });
      continue;
    }
    try {
      arAst = parseMessage(arValue);
    } catch (error) {
      addFinding(report.fatal, 'icu parse (ar)', {
        key,
        detail: (error as Error).message,
      });
      continue;
    }

    // 5. Placeholder + rich-tag parity.
    const enArgs = collectArgumentNames(enAst);
    const arArgs = collectArgumentNames(arAst);
    if (!setEquals(enArgs, arArgs)) {
      addFinding(report.fatal, 'placeholder mismatch', {
        key,
        detail: describeSetDiff(enArgs, arArgs),
      });
    }
    const enTags = collectTagNames(enAst);
    const arTags = collectTagNames(arAst);
    if (!setEquals(enTags, arTags)) {
      addFinding(report.fatal, 'rich-tag mismatch', {
        key,
        detail: describeSetDiff(enTags, arTags),
      });
    }

    // 6. Plural completeness (WARNING, or FATAL under --strict). Only messages
    // whose EN source uses a plural/selectordinal are held to the full CLDR set.
    const enPlurals = collectPluralNodes(enAst);
    if (enPlurals.length === 0) continue;
    const enPluralArgs = new Set(enPlurals.map((node) => node.argName));
    const arPlurals = collectPluralNodes(arAst);
    for (const argName of enPluralArgs) {
      const arNode = arPlurals.find((node) => node.argName === argName);
      if (!arNode) {
        record(report, strict, 'plural completeness', {
          key,
          detail: `ar has no plural block for "${argName}"`,
        });
        continue;
      }
      const missing = missingArabicPluralCategories(arNode);
      if (missing.length) {
        record(report, strict, 'plural completeness', {
          key,
          detail: `plural "${argName}" missing categories: {${missing.join(
            ', ',
          )}}`,
        });
      }
    }
  }

  return report;
}

/** Total findings in a bucket (fatal or warning). */
export function countFindings(bucket: Record<string, Finding[]>): number {
  return Object.values(bucket).reduce((sum, list) => sum + list.length, 0);
}

/** Print a bucket in a readable per-category form; returns its total count. */
export function printBucket(
  label: string,
  bucket: Record<string, Finding[]>,
): number {
  const categories = Object.keys(bucket);
  if (categories.length === 0) {
    console.log(`${label}: none`);
    return 0;
  }
  let total = 0;
  console.log(`${label}:`);
  for (const category of categories) {
    const findings = bucket[category];
    total += findings.length;
    console.log(`  [${category}] ${findings.length}`);
    for (const finding of findings.slice(0, 50)) {
      console.log(`    - ${finding.key}: ${finding.detail}`);
    }
    if (findings.length > 50) {
      console.log(`    ... and ${findings.length - 50} more`);
    }
  }
  return total;
}
