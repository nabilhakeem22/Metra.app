// How a builder number box SHOWS a figure it is not editing. PURE and
// CLIENT-SAFE.
//
// The server stores every figure at scale 4, so a draft loads "13200.0000",
// "0.0000" and "14.0000": a narrow box cut them off mid-digit. Trailing
// fractional zeros carry no value, so the box shows "13200", "0" and "14". It is
// display only: the line keeps the figure exactly as loaded or typed, and the
// save, the preview and the 4-decimal rule read that, never this. Anything that
// is not a plain decimal ("1,5", letters) is shown as it is, for the save to
// point at.
const PLAIN_DECIMAL = /^-?\d+\.\d+$/;

/** `figure` without its trailing fractional zeros (and a dot left bare). */
export function compactFigure(figure: string): string {
  if (!PLAIN_DECIMAL.test(figure)) return figure;
  return figure.replace(/0+$/, '').replace(/\.$/, '');
}
