import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { workerSourceFiles } from '@/test/source-files';

// Manrope and Tajawal are FILES in this folder, loaded by next/font/local in
// [locale]/layout.tsx, so a build fetches nothing. A path that names no file,
// or a 500 file labelled 400, lints and type-checks and fails (or misrenders)
// only inside `next build`. This reads the layout as text and holds every
// entry against the disk.
//
// The Google loader's module name and its two hosts are assembled below rather
// than written out, so a grep for them over src/ stays empty.

const FONTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIRECTORY = resolve(FONTS_DIRECTORY, '../..');
const WEB_DIRECTORY = resolve(SOURCE_DIRECTORY, '..');
const LAYOUT_PATH = join(SOURCE_DIRECTORY, 'app', '[locale]', 'layout.tsx');
const layoutSource = readFileSync(LAYOUT_PATH, 'utf8');

const GOOGLE_FONT_MODULE = ['next', 'font', 'google'].join('/');
const GOOGLE_FONT_HOSTS = ['googleapis', 'gstatic'].map((name) => `fonts.${name}.com`);

// Manrope is ONE variable file (`wght` in its name) and the layout declares the
// span of weights the app uses from it. Tajawal is one static file per weight.
const MANROPE_WEIGHT_SPAN = '400 700';
const TAJAWAL_WEIGHTS = ['400', '500', '700'];

// ORDER is part of the contract for Tajawal. Its faces carry no unicode-range
// (next/font/local takes one `declarations` list per call, not per file), so a
// browser asks the LAST declared face first: Latin last is the order Google
// served. next/font also measures the fallback font from the last 400 file,
// and only the Latin one has the letters that measurement needs.
const COMMITTED_FONT_FILES = [
  'manrope/manrope-latin-wght-normal.woff2',
  ...['arabic', 'latin'].flatMap((subset) =>
    TAJAWAL_WEIGHTS.map((weight) => `tajawal/tajawal-${subset}-${weight}-normal.woff2`),
  ),
];

interface FontSourceEntry {
  /** Relative to this folder, with '/'. */
  file: string;
  weight: string;
  style: string;
}

const SOURCE_ENTRY = /\{\s*path:\s*'([^']+)',\s*weight:\s*'([^']+)',\s*style:\s*'([^']+)',?\s*\}/g;

function layoutFontEntries(): FontSourceEntry[] {
  return [...layoutSource.matchAll(SOURCE_ENTRY)].map(([, path, weight, style]) => ({
    file: relative(FONTS_DIRECTORY, resolve(dirname(LAYOUT_PATH), path!)).replace(/\\/g, '/'),
    weight: weight!,
    style: style!,
  }));
}

/** What a file's name promises: `-500-normal`, or `-wght-normal` for the variable file. */
function labelNamedBy(file: string): { weight: string; style: string } | null {
  const named = /-(\d{3}|wght)-([a-z]+)\.woff2$/.exec(file);
  if (!named) return null;
  return { weight: named[1] === 'wght' ? MANROPE_WEIGHT_SPAN : named[1]!, style: named[2]! };
}

function fontFilesOnDisk(): string[] {
  return ['manrope', 'tajawal'].flatMap((family) =>
    readdirSync(join(FONTS_DIRECTORY, family))
      .filter((name) => /\.(woff2?|ttf|otf|eot)$/.test(name))
      .map((name) => `${family}/${name}`),
  );
}

/** The `var(--font-…)` names a stylesheet or config reads but no stylesheet defines. */
function fontVariablesLeftToTheLayout(): string[] {
  const globals = readFileSync(join(SOURCE_DIRECTORY, 'app', 'globals.css'), 'utf8');
  const tailwind = readFileSync(join(WEB_DIRECTORY, 'tailwind.config.ts'), 'utf8');
  const read = [...`${globals}\n${tailwind}`.matchAll(/var\((--font-[a-z-]+)\)/g)].map((match) => match[1]!);
  const defined = new Set([...globals.matchAll(/(--font-[a-z-]+)\s*:/g)].map((match) => match[1]!));
  return [...new Set(read)].filter((name) => !defined.has(name)).sort();
}

describe('the fonts are files in the repository', () => {
  const entries = layoutFontEntries();

  it('reads every font path the layout writes', () => {
    // A `src` written in a shape SOURCE_ENTRY does not read would escape every check below.
    expect(entries).toHaveLength(layoutSource.match(/\.(woff2?|ttf|otf|eot)'/g)?.length ?? 0);
  });

  it('loads the one Manrope and six Tajawal files, Arabic before Latin', () => {
    expect(entries.map((entry) => entry.file)).toEqual(COMMITTED_FONT_FILES);
  });

  it.each(COMMITTED_FONT_FILES)('%s is a WOFF2 file on disk', (file) => {
    const path = join(FONTS_DIRECTORY, file);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).subarray(0, 4).toString('latin1')).toBe('wOF2');
  });

  it('labels each file with the weight and style in its name', () => {
    const declared = entries.map(({ file, weight, style }) => ({ file, label: { weight, style } }));
    expect(declared).toEqual(entries.map(({ file }) => ({ file, label: labelNamedBy(file) })));
  });

  it('commits no font file the layout does not load', () => {
    expect(fontFilesOnDisk().sort()).toEqual([...COMMITTED_FONT_FILES].sort());
  });

  it.each(['manrope', 'tajawal'])('%s carries its licence', (family) => {
    const licence = readFileSync(join(FONTS_DIRECTORY, family, 'LICENSE'), 'utf8');
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});

describe('the layout keeps the contract the stylesheets read', () => {
  it('declares exactly the font variables globals.css and tailwind leave to it', () => {
    const declared = [...layoutSource.matchAll(/variable:\s*'(--font-[a-z-]+)'/g)].map((match) => match[1]!);
    expect(declared.sort()).toEqual(fontVariablesLeftToTheLayout());
    expect(declared).toEqual(['--font-manrope', '--font-tajawal']);
  });

  it('swaps both families in, as before', () => {
    expect(layoutSource.match(/display:\s*'swap'/g)).toHaveLength(2);
  });
});

describe('no build-time request for a font', () => {
  it('no module or stylesheet names the Google font loader or its hosts', () => {
    const stylesheets = readdirSync(SOURCE_DIRECTORY, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.css'))
      .map((name) => ({ path: name, text: readFileSync(join(SOURCE_DIRECTORY, name), 'utf8') }));
    const offenders = [...workerSourceFiles(['apps/web/src']), ...stylesheets]
      .filter(({ text }) => [GOOGLE_FONT_MODULE, ...GOOGLE_FONT_HOSTS].some((name) => text.includes(name)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
