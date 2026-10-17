// The checks that need the published history (none run with --offline):
//   B6  unit stability: an existing key keeps its unit and roll pack;
//   B7  identity clash: a NEW key whose label, unit and pack equal a published
//       item's under another key (map it instead of minting a duplicate);
//   B11 source reuse: this PDF or MD is already published for another period;
//   F2  restatement: a month an earlier bulletin published now reads differently,
//       or is empty now (a dropped cell is the classic misread);
//   F3  dropped: an active item with published history is missing from this file;
//   B0  a `discontinue` that names no published item (one already discontinued
//       is accepted: a --replace repeats its mapping), or a `map` to a
//       key that is not published (a typo would mint a new item).
// Values are compared as canonical decimals: "144.0" and "144" are one price.
import { finding, type Finding } from '../findings';
import { describePack, samePack } from '../roll-pack';
import { canonicalDecimal, sourceLabelOf } from '../normalize';
import { marketUnitOf } from '../units';
import { monthKey, type CheckContext } from './context';

function checkIdentityHistory(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const published = [...context.history.items.values()];
  for (const { row, pageId, itemKey, mapped } of context.rows) {
    const reading = marketUnitOf(row.unitLabelAr);
    if (reading === null) continue;
    const at = { rowId: row.rowId, page: pageId };
    const existing = context.history.items.get(itemKey);
    if (mapped && !existing) {
      findings.push(finding('B0', `mapping.json maps ${row.rowId} to ${itemKey}, which is not a published item: "map" reuses an existing key`, at));
      continue;
    }
    if (existing) {
      if (existing.unit !== reading.unit || !samePack(existing.pack, reading.pack)) {
        findings.push(
          finding('B6', `${itemKey} is published in ${existing.unit} (${describePack(existing.pack)}) and reads ${reading.unit} (${describePack(reading.pack)}) here: a unit change is a new key plus "discontinue" of the old one in mapping.json`, at),
        );
      }
      continue;
    }
    const label = sourceLabelOf(row.labelAr, row.specAr);
    const twin = published.find(
      (item) => item.sourceLabels.includes(label) && item.unit === reading.unit && samePack(item.pack, reading.pack),
    );
    if (twin) {
      findings.push(finding('B7', `new key ${itemKey} reads exactly like published ${twin.key} ("${label}", ${twin.unit}): reuse it ("map" in mapping.json) or tell them apart`, at));
    }
  }
  return findings;
}

function checkSourceReuse(context: CheckContext): Finding[] {
  const { source, period } = context.file;
  return context.history.bulletins
    .filter((bulletin) => bulletin.period !== period)
    .flatMap((bulletin) => {
      const reused = [
        source.pdfSha256 !== null && bulletin.pdfSha256 === source.pdfSha256 ? 'PDF' : null,
        source.mdSha256 !== null && bulletin.mdSha256 === source.mdSha256 ? 'MD' : null,
      ].filter((name): name is string => name !== null);
      return reused.map((name) => finding('B11', `this ${name} is already published as the ${bulletin.period} bulletin`));
    });
}

function checkRestatements(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const { row, pageId, itemKey, months } of context.rows) {
    const series = context.history.effective.get(itemKey);
    if (!series) continue;
    months.forEach((slot, index) => {
      if (index + 1 > context.bulletinMonth) return;
      const before = series.get(monthKey(context.file, index + 1));
      if (!before) return;
      const now = slot === null ? 'empty' : slot === 'suspended' ? 'suspended' : canonicalDecimal(slot);
      const then = before.status === 'suspended' ? 'suspended' : (before.price ?? 'empty');
      if (now !== then) {
        findings.push(finding('F2', `"${row.labelAr}" month ${index + 1} was ${then} in the ${before.bulletinPeriod} bulletin and reads ${now} now`, { rowId: row.rowId, page: pageId, month: index + 1 }));
      }
    });
  }
  return findings;
}

function checkDropped(context: CheckContext): Finding[] {
  const present = new Set(context.rows.map((resolved) => resolved.itemKey));
  const discontinued = new Set(context.discontinueKeys);
  return [...context.history.items.values()]
    .filter((item) => item.status === 'active' && item.hasHistory && !present.has(item.key) && !discontinued.has(item.key))
    .map((item) => finding('F3', `${item.key} has published prices and is missing from this bulletin`));
}

function checkDiscontinued(context: CheckContext): Finding[] {
  return context.discontinueKeys
    .filter((key) => !context.history.items.has(key))
    .map((key) => finding('B0', `mapping.json discontinues ${key}, which is not a published item`));
}

export const HISTORY_VALIDATORS = [checkIdentityHistory, checkSourceReuse, checkRestatements, checkDropped, checkDiscontinued];
