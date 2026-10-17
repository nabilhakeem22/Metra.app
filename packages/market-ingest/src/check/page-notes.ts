// F5 suspended pricing, F6 a price basis other than the bulletin default
// (taxes in, transport out, no minimum quantity), and the chart legend against
// the table: MORE legend labels than rows means a row was missed (B13, blocking);
// FEWER is the bulletin's own truncated legend (F7, seen on July 2026 PDF pages
// 76 to 79 and 86), a warning only.
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
    const [rows, labels] = [page.rows.length, page.legendLabelsAr.length];
    if (labels > rows) {
      findings.push(finding('B13', `the chart legend names ${labels} items but the table has ${rows} rows: a row was missed`, { page: pageId }));
    } else if (labels < rows) {
      findings.push(finding('F7', `${rows} rows but only ${labels} chart legend labels (the bulletin truncates some legends)`, { page: pageId }));
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
