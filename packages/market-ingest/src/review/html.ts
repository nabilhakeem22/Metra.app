// review.html: what the owner reads before approving a bulletin's hash. One
// self-contained RTL document, inline CSS, no JS, every text HTML-escaped.
import { detailChangesSection, skippedSection } from './changes';
import { STYLE, escapeHtml } from './html-parts';
import {
  blockingSection,
  confirmSection,
  correctionsSection,
  countsSection,
  diffSection,
  flagsSection,
  headerSection,
  listSection,
  type ReviewInput,
} from './sections';

export type { ReviewInput };

export function renderReview(input: ReviewInput): string {
  const body = [
    headerSection(input),
    countsSection(input),
    blockingSection(input),
    confirmSection(input),
    flagsSection(input),
    skippedSection(input),
    diffSection(input),
    detailChangesSection(input),
    listSection(input, 'F4', 'new', 'New items'),
    listSection(input, 'F3', 'dropped', 'Dropped items'),
    correctionsSection(input),
  ].join('\n');
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market bulletin review ${escapeHtml(input.period)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
