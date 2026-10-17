// B3 units map, B4 taxonomy and key shape, B5 uniqueness of row ids and keys.
import { finding, type Finding } from '../findings';
import { isLeafCategory } from '../taxonomy';
import { looksLikeRoll } from '../roll-pack';
import { marketUnitOf } from '../units';
import { pageIdOf, type CheckContext } from './context';

const ITEM_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+){2,}$/;

/** Page-level identity: the leaf exists, row ids are unique, the yearly table names a row. */
function checkPages(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const rowIds = new Set<string>();
  for (const page of context.file.pages) {
    const pageId = pageIdOf(context.file, page);
    if (!isLeafCategory(page.subCategoryKey)) {
      findings.push(finding('B4', `"${page.subCategoryKey}" is not a taxonomy leaf (src/taxonomy.ts)`, { page: pageId }));
    }
    for (const row of page.rows) {
      if (rowIds.has(row.rowId)) findings.push(finding('B5', `row id ${row.rowId} appears twice`, { rowId: row.rowId, page: pageId }));
      rowIds.add(row.rowId);
    }
    const yearly = page.yearly;
    if (yearly && !page.rows.some((row) => row.rowId === yearly.rowId)) {
      findings.push(finding('B5', `yearly.rowId ${yearly.rowId} names no row on this page`, { page: pageId }));
    }
  }
  return findings;
}

export function checkIdentity(context: CheckContext): Finding[] {
  const findings = checkPages(context);
  const keys = new Map<string, string>();
  for (const { row, page, pageId, itemKey } of context.rows) {
    const at = { rowId: row.rowId, page: pageId };
    if (marketUnitOf(row.unitLabelAr) === null) {
      const reason = looksLikeRoll(row.unitLabelAr)
        ? 'is a roll without a readable pack size (src/roll-pack.ts)'
        : 'is not in the unit map (src/units.ts)';
      findings.push(finding('B3', `unit "${row.unitLabelAr}" ${reason}`, at));
    }
    if (!ITEM_KEY.test(itemKey)) {
      findings.push(finding('B4', `key "${itemKey}" must match ${ITEM_KEY.source}`, at));
    } else if (itemKey === row.proposedKey && !itemKey.startsWith(`${page.subCategoryKey}.`)) {
      findings.push(finding('B4', `key "${itemKey}" must start with its page's sub-category "${page.subCategoryKey}."`, at));
    }
    const holder = keys.get(itemKey);
    if (holder !== undefined) findings.push(finding('B5', `key "${itemKey}" is also used by ${holder}`, at));
    else keys.set(itemKey, row.rowId);
  }
  return findings;
}
