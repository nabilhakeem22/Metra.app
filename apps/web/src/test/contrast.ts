// TEST-ONLY. WCAG contrast over the theme tokens in globals.css, so a token
// edit that drops a pairing under its floor fails a unit test instead of
// shipping. Pure: string in, numbers out.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ThemeTokens = Map<string, string>;

/** `--name: value;` declarations of the FIRST block whose selector list matches. */
export function themeTokens(css: string, selector: RegExp): ThemeTokens {
  const block = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`no block for ${selector}`);
  const tokens: ThemeTokens = new Map();
  const body = block[1]!.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1]!, match[2]!.trim());
  }
  return tokens;
}

function hslToRgb(h: number, s: number, l: number): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: 1 };
}

/** #rgb / #rrggbb, rgba(r, g, b, a), or a bare `H S% L%` triplet (the shadcn bridge). */
export function parseColour(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!;
    const n = Number.parseInt(digits, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1]!.split(',').map((part) => part.trim());
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }
  const triplet = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (triplet) {
    return hslToRgb(Number(triplet[1]), Number(triplet[2]) / 100, Number(triplet[3]) / 100);
  }
  throw new Error(`unparsed colour: ${value}`);
}

/** A translucent colour laid over an opaque one. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const ink = foreground.a < 1 ? over(foreground, background) : foreground;
  const [light, dark] = [luminance(ink), luminance(background)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
