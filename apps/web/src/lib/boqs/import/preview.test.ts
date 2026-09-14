import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES, MAX_IMPORT_CELLS } from '@/lib/import/limits';
import { previewBoqImportText } from './preview';

// The hostile-file fence. The uploader reads the whole file with `file.text()`
// and hands the string to the preview, so these two ceilings — total size and
// total cells — are the only thing between a 1 MiB payload and the isolate's
// heap. A row cap alone bounds neither: 1 MiB of commas is ONE row.

/** How long the preview took, to the nearest millisecond. */
function millisecondsFor(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('previewBoqImportText caps', () => {
  it('reads an ordinary sheet', () => {
    const preview = previewBoqImportText('Description,Unit,Qty,Rate\nWalls,m2,10,250\n');
    expect(preview.ok).toBe(true);
    expect(preview.lines).toHaveLength(1);
  });

  it('refuses an oversized upload before decoding it', () => {
    const oversized = 'a'.repeat(MAX_IMPORT_BYTES + 1);
    let preview!: ReturnType<typeof previewBoqImportText>;
    const elapsed = millisecondsFor(() => {
      preview = previewBoqImportText(oversized);
    });
    expect(preview).toEqual({ ok: false, error: 'import_too_large' });
    // "Before decoding" is the claim, so it has to be fast: parsing 5 MiB took
    // tens of milliseconds and tens of megabytes.
    expect(elapsed).toBeLessThan(50);
  });

  it('refuses 1 MiB of commas — one row, a million cells', () => {
    // The shape the row cap could never see. Under MAX_IMPORT_BYTES, a single
    // row, and 1,048,577 fields (+17.6 MiB of heap) before this cap existed.
    const oneWideRow = ','.repeat(1024 * 1024);
    const preview = previewBoqImportText(oneWideRow);
    expect(preview).toEqual({ ok: false, error: 'import_too_large' });
  });

  it('bounds an unterminated quote too', () => {
    // An open quote swallows the rest of the file into ONE field, so neither the
    // row nor the cell counter moves — the size cap is what bounds this one, and
    // what is under it stays a legal (if useless) one-cell sheet.
    const openQuote = `"${'x'.repeat(2 * 1024 * 1024)}`;
    expect(previewBoqImportText(openQuote).ok).toBe(true);
    expect(previewBoqImportText(`"${'x'.repeat(MAX_IMPORT_BYTES)}`)).toEqual({
      ok: false,
      error: 'import_too_large',
    });
  });

  it('accepts a sheet just under the cell ceiling and refuses just over it', () => {
    // Non-blank cells: a row of bare commas is dropped as blank before the
    // header check and would answer 'invalid' for a reason that is not the cap.
    const row = (cells: number) => `${'x,'.repeat(cells - 1)}x\n`;
    expect(previewBoqImportText(row(MAX_IMPORT_CELLS)).error).toBeUndefined();
    expect(previewBoqImportText(row(MAX_IMPORT_CELLS + 1))).toEqual({
      ok: false,
      error: 'import_too_large',
    });
  });

  it('still refuses an empty or non-string body as invalid', () => {
    expect(previewBoqImportText('   ')).toEqual({ ok: false, error: 'invalid' });
    expect(previewBoqImportText(42 as unknown as string)).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
