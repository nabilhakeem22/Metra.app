import { vi } from 'vitest';

// TEST-ONLY. happy-dom reports every `<img>` as `complete` with no pixels, which
// is what a browser reports for a picture that FAILED. A gallery tile checks
// exactly that on mount (a failure before hydration), so a test that renders
// tiles calls this first: every picture is still loading, as in a browser at
// mount time.
export function picturesStillLoading(): void {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
}
