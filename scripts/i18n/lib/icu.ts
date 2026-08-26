/**
 * ICU MessageFormat analysis helpers built on
 * `@formatjs/icu-messageformat-parser` (already a transitive dep via next-intl;
 * no new runtime dependency).
 *
 * Used by the validator to compare the *structure* of a translated message
 * against its English source: the set of placeholder/argument names must match
 * byte-for-byte, and any Arabic plural must carry the full CLDR category set.
 */
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';

/** CLDR plural categories Arabic (ar) actually uses; all six are required. */
export const ARABIC_PLURAL_CATEGORIES = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
] as const;

export type PluralNodeReport = {
  /** The argument name the plural/selectordinal is keyed on. */
  argName: string;
  /** Whether this node is a `selectordinal` (vs a cardinal `plural`). */
  ordinal: boolean;
  /** The category names actually present on the node. */
  categories: string[];
};

/**
 * Parse a message, throwing a readable error if it is structurally invalid.
 * Returns the AST for further inspection.
 */
export function parseMessage(message: string): MessageFormatElement[] {
  return parse(message);
}

/**
 * Collect the set of argument names referenced by a message: plain args
 * (`{name}`), number/date/time args, and the keys of `plural`/`selectordinal`/
 * `select` blocks — recursing into every sub-message. Rich text tags
 * (`<b>...</b>`) are recursed into but their tag names are collected separately
 * (see {@link collectTagNames}) because they are not value placeholders.
 */
export function collectArgumentNames(ast: MessageFormatElement[]): Set<string> {
  const names = new Set<string>();
  walk(ast, {
    onArg: (name) => names.add(name),
    onTag: () => undefined,
  });
  return names;
}

/** Collect the set of rich-text tag names (`<b>`, `<accent>`, ...). */
export function collectTagNames(ast: MessageFormatElement[]): Set<string> {
  const names = new Set<string>();
  walk(ast, {
    onArg: () => undefined,
    onTag: (name) => names.add(name),
  });
  return names;
}

/** Collect every plural / selectordinal node in the message (recursively). */
export function collectPluralNodes(
  ast: MessageFormatElement[],
): PluralNodeReport[] {
  const reports: PluralNodeReport[] = [];
  const visit = (elements: MessageFormatElement[]): void => {
    for (const element of elements) {
      // `selectordinal` is represented as a plural element carrying
      // `pluralType: 'ordinal'`; a cardinal `plural` carries 'cardinal'.
      if (element.type === TYPE.plural) {
        const ordinal = element.pluralType === 'ordinal';
        reports.push({
          argName: element.value,
          ordinal,
          categories: Object.keys(element.options),
        });
      }
      // Recurse into sub-messages of plural/select options and tag children.
      if (element.type === TYPE.plural || element.type === TYPE.select) {
        for (const category of Object.keys(element.options)) {
          visit(element.options[category].value);
        }
      } else if (element.type === TYPE.tag) {
        visit(element.children);
      }
    }
  };
  visit(ast);
  return reports;
}

/**
 * Which required Arabic CLDR categories a plural node is missing. Empty array
 * means complete.
 */
export function missingArabicPluralCategories(node: PluralNodeReport): string[] {
  const present = new Set(node.categories);
  return ARABIC_PLURAL_CATEGORIES.filter((category) => !present.has(category));
}

type WalkHandlers = {
  onArg: (name: string) => void;
  onTag: (name: string) => void;
};

function walk(elements: MessageFormatElement[], handlers: WalkHandlers): void {
  for (const element of elements) {
    switch (element.type) {
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        handlers.onArg(element.value);
        break;
      case TYPE.select:
      case TYPE.plural:
        handlers.onArg(element.value);
        for (const category of Object.keys(element.options)) {
          walk(element.options[category].value, handlers);
        }
        break;
      case TYPE.tag:
        handlers.onTag(element.value);
        walk(element.children, handlers);
        break;
      // literal (0) and pound (7) carry no argument names.
      default:
        break;
    }
  }
}
