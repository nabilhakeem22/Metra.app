// What "Send as BOQ" will actually send, counted the way the mapper counts it.
// PURE and CLIENT-SAFE: the builder's confirm dialog states these figures, and
// they must equal the ones the server writes.

/**
 * Sections and lines that will reach the BOQ. A section with no lines is
 * dropped by the mapper, so it is not counted here either.
 */
export function countSendable(
  sections: ReadonlyArray<{ lines: ReadonlyArray<unknown> }>,
): { sectionCount: number; lineCount: number } {
  let sectionCount = 0;
  let lineCount = 0;
  for (const section of sections) {
    if (section.lines.length === 0) continue;
    sectionCount += 1;
    lineCount += section.lines.length;
  }
  return { sectionCount, lineCount };
}
