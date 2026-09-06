// The Metra palette for PRINTED DOCUMENTS, as literal hex.
//
// The proposal and contract PDFs are rendered by a headless Chromium from a
// standalone HTML string, so they can use CSS but not the app's runtime tokens —
// there is no theme, no :root to inherit from. These constants keep the two
// templates in step with each other and with the identity.
//
// Only the palette is shared. The templates' LAYOUT genuinely differs (totals
// width, the contract's terms block), so their style blocks stay separate rather
// than being forced through one parameterised stylesheet.
//
// Tuned for paper: values are the light palette, but table rules are a step
// stronger than the on-screen --rule, which disappears when printed.

export const PDF_BRAND = {
  /** Headings and the grand-total rule. */
  text: '#111418',
  /** Meta lines under the title. */
  muted: '#5C6470',
  /** Footer. */
  faint: '#5C6470',
  /** Table header fill — the brand. */
  brand: '#2E6BE6',
  /** Text on the brand fill. */
  onBrand: '#FFFFFF',
  /** Cell borders. */
  rule: '#D5DAE2',
  /** Section heading rows. */
  sectionRow: '#E4E9F0',
  /** Subtotal rows. */
  subtotalRow: '#F5F7FA',
} as const;
