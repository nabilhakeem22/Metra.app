// The primitives the bulletin guard is written in: each one checks one JSON
// value, records a specific finding on failure and never throws. Values arrive
// from JSON.parse, so `unknown` is the honest input type.
import { finding, type Finding, type FindingCode } from './findings';

/** Where a value sits, for the message and for the finding's row/page columns. */
export interface ShapeContext {
  path: string;
  rowId?: string | null;
  page?: number | null;
}

const DECIMAL = /^[0-9]+(\.[0-9]{1,4})?$/;
const ARABIC_INDIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;
const SHA256 = /^[0-9a-f]{64}$/;
const EM_OR_EN_DASH = /[\u2013\u2014]/;

export class ShapeReader {
  readonly findings: Finding[] = [];

  fail(code: FindingCode, at: ShapeContext, message: string, month?: number): void {
    this.findings.push(
      finding(code, `${at.path}: ${message}`, { rowId: at.rowId, page: at.page, month }),
    );
  }

  /** A plain object with EXACTLY these keys; unknown and missing keys are both refused. */
  object(value: unknown, keys: readonly string[], at: ShapeContext): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail('B0', at, 'expected an object');
      return false;
    }
    const present = Object.keys(value);
    for (const key of present) {
      if (!keys.includes(key)) this.fail('B0', at, `unknown key "${key}"`);
    }
    for (const key of keys) {
      if (!present.includes(key)) this.fail('B0', at, `missing key "${key}"`);
    }
    return present.length === keys.length && keys.every((key) => present.includes(key));
  }

  /** `displayed`: a text studios will see, so Western digits only and no em/en dash. */
  text(value: unknown, at: ShapeContext, options: { nullable?: boolean; nonEmpty?: boolean; displayed?: boolean } = {}): void {
    if (value === null && options.nullable) return;
    if (typeof value !== 'string') {
      this.fail('B0', at, options.nullable ? 'expected a string or null' : 'expected a string');
      return;
    }
    if (options.nonEmpty && value.trim() === '') this.fail('B0', at, 'must not be empty');
    if (!options.displayed) return;
    if (ARABIC_INDIC_DIGIT.test(value)) {
      this.fail('B2', at, 'Arabic-Indic digit in a text studios see; write Western digits (verbatimCells keep the printed form)');
    }
    if (EM_OR_EN_DASH.test(value)) this.fail('B0', at, 'em or en dash; write a hyphen');
  }

  positiveInteger(value: unknown, at: ShapeContext, nullable = false): void {
    if (value === null && nullable) return;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      this.fail('B0', at, `expected a positive integer${nullable ? ' or null' : ''}`);
    }
  }

  boolean(value: unknown, at: ShapeContext): void {
    if (typeof value !== 'boolean') this.fail('B0', at, 'expected true or false');
  }

  oneOf(value: unknown, allowed: readonly string[], at: ShapeContext): void {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      this.fail('B0', at, `expected one of ${allowed.map((option) => `"${option}"`).join(', ')}`);
    }
  }

  sha256(value: unknown, at: ShapeContext): void {
    if (value === null) return;
    if (typeof value !== 'string' || !SHA256.test(value)) {
      this.fail('B0', at, 'expected 64 lowercase hex characters or null');
    }
  }

  /** A Western-digit decimal; the message names the usual misreadings. */
  decimal(value: unknown, at: ShapeContext, month?: number): void {
    if (typeof value !== 'string') {
      this.fail('B2', at, 'a value is a string of Western digits, e.g. "38200" or "30.455"', month);
      return;
    }
    if (DECIMAL.test(value)) return;
    let reason = 'not a decimal of Western digits with at most 4 decimal places';
    if (ARABIC_INDIC_DIGIT.test(value)) {
      reason = 'Arabic-Indic digit; values use Western digits (the printed text goes in verbatimCells)';
    } else if (/[,\u060C\u066B\u066C]/.test(value)) {
      reason = 'separator in a value; write "38200" not "38,200" and "10.374" not "10,374"';
    } else if (value.startsWith('-') || value.startsWith('+')) {
      reason = 'a value carries no sign';
    }
    this.fail('B2', at, `"${value}" is refused: ${reason}`, month);
  }

  /** Exactly 12 entries (B1); each one checked by `entry`. */
  twelve(value: unknown, at: ShapeContext, entry: (item: unknown, month: number) => void): void {
    if (!Array.isArray(value)) {
      this.fail('B1', at, 'expected an array of 12 months');
      return;
    }
    if (value.length !== 12) {
      this.fail('B1', at, `expected 12 months (January..December), found ${value.length}`);
      return;
    }
    value.forEach((item, index) => entry(item, index + 1));
  }

  stringArray(value: unknown, at: ShapeContext): void {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      this.fail('B0', at, 'expected an array of strings');
    }
  }
}
