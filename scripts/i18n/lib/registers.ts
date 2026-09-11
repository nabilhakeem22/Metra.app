/**
 * Which Arabic register a message key is written in.
 *
 * PURE and dependency-free so the unit test can reach it. The policy itself
 * lives in `registers.json` next to this file — see style-guide.md for why the
 * line sits where it does.
 *
 * LONGEST MATCHING PREFIX WINS. That rule is what lets `delivery.share.` (the
 * studio's own control) sit inside `delivery.` (the client's portal) without the
 * two fighting, and it means the JSON can be ordered for a human reader rather
 * than for the matcher.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Register = 'eg' | 'msa';

export interface RegisterRule {
  prefix: string;
  register: Register;
  why?: string;
}

export interface RegisterPolicy {
  default: Register;
  rules: RegisterRule[];
}

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/i18n/lib
export const REGISTERS_PATH = resolve(HERE, '../registers.json');

export function loadPolicy(path: string = REGISTERS_PATH): RegisterPolicy {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RegisterPolicy & {
    _doc?: unknown;
  };
  if (raw.default !== 'eg' && raw.default !== 'msa') {
    throw new Error(`registers.json: default must be "eg" or "msa"`);
  }
  if (!Array.isArray(raw.rules)) {
    throw new Error('registers.json: rules must be an array');
  }
  for (const rule of raw.rules) {
    if (rule.register !== 'eg' && rule.register !== 'msa') {
      throw new Error(
        `registers.json: rule "${rule.prefix}" has register "${rule.register}"`,
      );
    }
  }
  return { default: raw.default, rules: raw.rules };
}

/** The register for one dotted message key. */
export function registerFor(key: string, policy: RegisterPolicy): Register {
  let best: RegisterRule | null = null;
  for (const rule of policy.rules) {
    if (!key.startsWith(rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best ? best.register : policy.default;
}

/** Split a flat catalog into the two registers, preserving key order. */
export function splitByRegister<T>(
  flat: Record<string, T>,
  policy: RegisterPolicy,
): { eg: Record<string, T>; msa: Record<string, T> } {
  const eg: Record<string, T> = {};
  const msa: Record<string, T> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (registerFor(key, policy) === 'eg') eg[key] = value;
    else msa[key] = value;
  }
  return { eg, msa };
}

/**
 * The register-specific half of the model's system instruction.
 *
 * Appended to style-guide.md per chunk, so a single run can produce both
 * registers correctly and a re-translation of the whole catalogue cannot
 * silently turn a client's contract page into slang.
 */
export function registerDirective(register: Register): string {
  if (register === 'msa') {
    return [
      '## REGISTER FOR THIS CHUNK: Modern Standard Arabic (فصحى)',
      '',
      'Every key in this chunk is read by the STUDIO\'S CLIENT, or is part of a',
      'document (contract, quotation, delivery portal, PDF). Use clean, neutral',
      'فصحى. No عامية, no ده/دي/دلوقتي/عشان/مش/بس, no colloquial verb forms.',
      'This copy carries legal and commercial weight; the register is part of',
      'that weight.',
    ].join('\n');
  }
  return [
    '## REGISTER FOR THIS CHUNK: Egyptian Arabic (عامية مصرية)',
    '',
    'Every key in this chunk is read by the STUDIO\'S OWN TEAM while they work —',
    'owners, project managers, site engineers, accountants. Write the way a',
    'competent Egyptian colleague speaks: direct, warm, unfussy.',
    '',
    'Use the Egyptian word, not the فصحى one:',
    '- تقدر — not يمكنك / بإمكانك / تستطيع',
    '- ده / دي / دول — not هذا / هذه / هؤلاء',
    '- دلوقتي — not الآن;  بعدين — not لاحقًا;  كمان — not أيضًا',
    '- مفيش — not لا يوجد / لا توجد;  مش — not ليس / غير',
    '- عشان — not كي / لكي;  لو — not إذا;  إزاي — not كيف;  ليه — not لماذا',
    '- لازم — not يجب;  بس — not فقط',
    '',
    'REBUILD THE SENTENCE, DO NOT SWAP WORDS. The failure mode is فصحى مقنّعة:',
    'Egyptian vocabulary on an MSA skeleton. "يمكنك تغيير هذه الإعدادات لاحقًا"',
    'does not become "يمكنك تغيير الإعدادات دي بعدين" — it becomes',
    '"تقدر تغيّرها بعدين". Say it out loud; if no one would say it, rewrite it.',
    '',
    'Still forbidden here: slang that is rude or over-familiar, jokes, emoji,',
    'exclamation marks, and any greeting or filler the English does not have.',
    'Warmth is natural phrasing, not added words.',
    '',
    'The locked glossary still wins. Domain nouns stay as the glossary states',
    'them (العقد، الفاتورة، المقايسة، البند، الدفعة) even in an Egyptian sentence —',
    'those are the words the trade actually uses.',
  ].join('\n');
}
