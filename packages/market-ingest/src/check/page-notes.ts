// F5 suspended pricing, F6 a price basis other than the bulletin default
// (taxes in, transport out, no minimum quantity), F7 a row count that differs
// from the chart legend.
import { finding, type Finding } from '../findings';
import type { PageV1 } from '../format';
import { pageIdOf, type CheckContext } from './context';

/** True when the page's basis is not the bulletin default; the item then shows its basis note. */
export function basisDiffers(page: PageV1): boolean {
  return !page.basis.includesTaxes || page.basis.includesTransport || page.basis.minimumQuantityAr !== null;
}

export function checkPageNotes(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const page of context.file.pages) {
    const pageId = pageIdOf(context.file, page);
    if (page.suspendedNoteAr !== null) {
      findings.push(finding('F5', `the page carries the stamp "${page.suspendedNoteAr}"`, { page: pageId }));
    }
    if (basisDiffers(page)) {
      findings.push(finding('F6', `price basis differs from the default: "${page.basisNoteAr}"`, { page: pageId }));
    }
    if (page.rows.length !== page.legendLabelsAr.length) {
      findings.push(finding('F7', `${page.rows.length} rows but ${page.legendLabelsAr.length} chart legend labels`, { page: pageId }));
    }
  }
  for (const { row, pageId, months } of context.rows) {
    const suspended = months.flatMap((slot, index) => (slot === 'suspended' ? [index + 1] : []));
    if (suspended.length > 0) {
      findings.push(finding('F5', `"${row.labelAr}" is suspended in months ${suspended.join(', ')}`, { rowId: row.rowId, page: pageId }));
    }
  }
  return findings;
}
