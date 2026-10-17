// The owner's two optional override files, guarded like the bulletin itself:
//   mapping.json      { [rowId]: map | skip | discontinue }
//   corrections.json  [{ rowId, month: 1..12, value, reason }]
// Corrections are how a PDF-confirmed value replaces an inferred or unreadable one.
import type { Finding } from './findings';
import type { Slot } from './format';
import { ShapeReader } from './guard-shape';

export type MappingEntry =
  | { action: 'map'; itemKey: string }
  | { action: 'skip'; reason: string }
  | { action: 'discontinue'; itemKey: string };

export type Mapping = Record<string, MappingEntry>;

export interface Correction {
  rowId: string;
  month: number;
  value: Slot;
  reason: string;
}

export function guardMapping(value: unknown): { mapping: Mapping; findings: Finding[] } {
  const reader = new ShapeReader();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reader.fail('B0', { path: 'mapping.json' }, 'expected an object keyed by rowId');
    return { mapping: {}, findings: reader.findings };
  }
  for (const [rowId, entry] of Object.entries(value)) {
    const at = { path: `mapping.json[${rowId}]`, rowId };
    const action = (entry as { action?: unknown } | null)?.action;
    if (action === 'skip') {
      if (reader.object(entry, ['action', 'reason'], at)) reader.text(entry.reason, at, { nonEmpty: true });
    } else if (action === 'map' || action === 'discontinue') {
      if (reader.object(entry, ['action', 'itemKey'], at)) reader.text(entry.itemKey, at, { nonEmpty: true });
    } else {
      reader.fail('B0', at, 'action must be "map", "skip" or "discontinue"');
    }
  }
  return { mapping: reader.findings.length === 0 ? (value as Mapping) : {}, findings: reader.findings };
}

export function guardCorrections(value: unknown): { corrections: Correction[]; findings: Finding[] } {
  const reader = new ShapeReader();
  if (!Array.isArray(value)) {
    reader.fail('B0', { path: 'corrections.json' }, 'expected an array');
    return { corrections: [], findings: reader.findings };
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const at = { path: `corrections.json[${index}]` };
    if (!reader.object(entry, ['rowId', 'month', 'value', 'reason'], at)) return;
    reader.text(entry.rowId, { ...at, path: `${at.path}.rowId` }, { nonEmpty: true });
    reader.text(entry.reason, { ...at, path: `${at.path}.reason` }, { nonEmpty: true });
    const month = entry.month;
    if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
      reader.fail('B0', { ...at, path: `${at.path}.month` }, 'expected a month number 1..12');
    }
    if (entry.value !== null && entry.value !== 'suspended') {
      reader.decimal(entry.value, { ...at, path: `${at.path}.value` });
    }
    const slotKey = `${String(entry.rowId)}#${String(month)}`;
    if (seen.has(slotKey)) reader.fail('B0', at, `a second correction for ${String(entry.rowId)} month ${String(month)}`);
    seen.add(slotKey);
  });
  return { corrections: reader.findings.length === 0 ? (value as Correction[]) : [], findings: reader.findings };
}
