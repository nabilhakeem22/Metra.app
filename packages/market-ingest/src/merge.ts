// Part files (C6.1b): a session may write `parts/<top-category>.json`, each a
// full bulletin file with an identical header and a subset of the pages. This
// guards every part and joins them; a page present twice is left in the merged
// file on purpose, so the coverage check (B8) names it.
import { finding, type Finding } from './findings';
import type { MarketBulletinFileV1 } from './format';
import { guardBulletinFile } from './guard';

export interface ProducerFile {
  name: string;
  value: unknown;
}

/** The header every part must repeat exactly. */
function headerOf(file: MarketBulletinFileV1): string {
  return JSON.stringify([file.format, file.publisher, file.period, file.readFrom, file.source]);
}

function prefixed(name: string, findings: Finding[]): Finding[] {
  return findings.map((item) => ({ ...item, message: `${name} ${item.message}` }));
}

export function mergeProducerFiles(
  files: ProducerFile[],
): { file: MarketBulletinFileV1 | null; findings: Finding[] } {
  const guarded: MarketBulletinFileV1[] = [];
  const findings: Finding[] = [];
  for (const { name, value } of files) {
    const result = guardBulletinFile(value);
    if (result.ok) guarded.push(result.file);
    else findings.push(...prefixed(name, result.findings));
  }
  if (findings.length > 0 || guarded.length === 0) return { file: null, findings };
  if (guarded.length === 1) return { file: guarded[0], findings };

  const [first, ...rest] = guarded;
  rest.forEach((part, index) => {
    if (headerOf(part) !== headerOf(first)) {
      findings.push(
        finding('B0', `${files[index + 1].name} has a header (format, publisher, period, readFrom, source) that differs from ${files[0].name}`),
      );
    }
  });
  if (findings.length > 0) return { file: null, findings };

  const producers = [...new Set(guarded.map((part) => part.producedBy))];
  const pageId = (page: MarketBulletinFileV1['pages'][number]) =>
    (first.readFrom === 'pdf' ? page.pdfPage : page.printedPage) ?? 0;
  return {
    file: {
      ...first,
      producedBy: producers.join('; '),
      pages: guarded.flatMap((part) => part.pages).sort((a, b) => pageId(a) - pageId(b)),
      skippedPages: guarded.flatMap((part) => part.skippedPages),
    },
    findings,
  };
}
