// B8: price pages and skipped pages together cover every page exactly once:
// PDF pages 1..pdfPageCount when read from the PDF, printed pages
// 1..lastPrintedPage when read from the MD. (Printed numbers are NOT unique in
// a PDF: the July 2026 company directories restart at 15 and 70.)
import { finding, type Finding } from '../findings';
import type { CheckContext } from './context';

export function checkCoverage(context: CheckContext): Finding[] {
  const { file } = context;
  const fromPdf = file.readFrom === 'pdf';
  const last = (fromPdf ? file.source.pdfPageCount : file.source.lastPrintedPage) ?? 0;
  const label = fromPdf ? 'PDF page' : 'printed page';
  const counts = new Map<number, number>();
  const findings: Finding[] = [];
  const entries = [
    ...file.pages.map((page) => (fromPdf ? page.pdfPage : page.printedPage)),
    ...file.skippedPages.map((skipped) => (fromPdf ? skipped.pdfPage : skipped.printedPage)),
  ];
  for (const pageNumber of entries) {
    if (pageNumber === null) {
      findings.push(finding('B8', `a skipped page has no ${label} number`));
      continue;
    }
    counts.set(pageNumber, (counts.get(pageNumber) ?? 0) + 1);
  }
  for (const [pageNumber, count] of counts) {
    if (pageNumber > last) findings.push(finding('B8', `${label} ${pageNumber} is beyond the last page ${last}`, { page: pageNumber }));
    if (count > 1) findings.push(finding('B8', `${label} ${pageNumber} is covered ${count} times`, { page: pageNumber }));
  }
  for (let pageNumber = 1; pageNumber <= last; pageNumber += 1) {
    if (!counts.has(pageNumber)) {
      findings.push(finding('B8', `${label} ${pageNumber} is neither a price page nor a skipped page`, { page: pageNumber }));
    }
  }
  return findings;
}
