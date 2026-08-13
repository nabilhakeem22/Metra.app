import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the fonts dir across dev (cwd = apps/web) and bundled server output.
function fontsDir(): string {
  const candidates = [
    (() => {
      try {
        return resolve(dirname(fileURLToPath(import.meta.url)), 'fonts');
      } catch {
        return '';
      }
    })(),
    resolve(process.cwd(), 'src/lib/pdf/fonts'),
    resolve(process.cwd(), 'apps/web/src/lib/pdf/fonts'),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(resolve(dir, 'IBMPlexSansArabic-Regular.ttf'))) {
      return dir;
    }
  }
  // Not found — callers degrade to fallback fonts rather than crashing the
  // render (the in-app preview still shows; the browser has its own fonts).
  return '';
}

export function fontBase64(file: string): string {
  const dir = fontsDir();
  if (!dir) return '';
  try {
    return readFileSync(resolve(dir, file)).toString('base64');
  } catch {
    return '';
  }
}

/**
 * Shared @font-face block (IBM Plex Sans Arabic + Cairo, base64-embedded).
 * Emits a face only when its file actually loaded, so a missing fonts dir
 * degrades to the fallback family instead of throwing / emitting a broken URI.
 */
export function fontFaceCss(): string {
  const face = (family: string, weight: string, file: string): string => {
    const b64 = fontBase64(file);
    return b64
      ? `@font-face { font-family: '${family}'; font-weight: ${weight};
    src: url(data:font/ttf;base64,${b64}) format('truetype'); }`
      : '';
  };
  return [
    face('IBM Plex Sans Arabic', '400', 'IBMPlexSansArabic-Regular.ttf'),
    face('IBM Plex Sans Arabic', '700', 'IBMPlexSansArabic-Bold.ttf'),
    face('Cairo', '400 900', 'Cairo-Variable.ttf'),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Standalone HTML for the Arabic-PDF spike. Embeds IBM Plex Sans Arabic + Cairo
 * as base64 @font-face (no network at render time), then renders:
 *  (a) a mixed Arabic / English / numeral line, and
 *  (b) an RTL table with three numeric columns.
 * This is where naive renderers break (shaping, ligatures, bidi).
 */
export function buildSpikeHtml(): string {
  const plexRegular = fontBase64('IBMPlexSansArabic-Regular.ttf');
  const plexBold = fontBase64('IBMPlexSansArabic-Bold.ttf');
  const cairo = fontBase64('Cairo-Variable.ttf');

  const rows = [
    { desc: 'غرفة المعيشة Living Room', qty: '12', price: '1,250.00', total: '15,000.00' },
    { desc: 'دهانات Paint — 3 معاطف', qty: '85', price: '95.50', total: '8,117.50' },
    { desc: 'أرضيات رخام Marble Flooring', qty: '40', price: '2,300.00', total: '92,000.00' },
  ];

  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td class="desc">${r.desc}</td>
        <td class="num">${r.qty}</td>
        <td class="num">${r.price}</td>
        <td class="num">${r.total}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ar-EG" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'IBM Plex Sans Arabic';
    font-weight: 400;
    src: url(data:font/ttf;base64,${plexRegular}) format('truetype');
  }
  @font-face {
    font-family: 'IBM Plex Sans Arabic';
    font-weight: 700;
    src: url(data:font/ttf;base64,${plexBold}) format('truetype');
  }
  @font-face {
    font-family: 'Cairo';
    font-weight: 400 900;
    src: url(data:font/ttf;base64,${cairo}) format('truetype');
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans Arabic', 'Cairo', sans-serif;
    margin: 0;
    padding: 32px;
    color: #0f172a;
    font-size: 14px;
  }
  h1 { font-family: 'Cairo'; font-weight: 800; font-size: 22px; margin: 0 0 4px; }
  .descriptor { color: #475569; margin-block-end: 24px; }
  .mixed-line {
    font-size: 16px;
    padding: 12px 16px;
    background: #f1f5f9;
    border-radius: 8px;
    margin-block-end: 24px;
  }
  table { width: 100%; border-collapse: collapse; }
  caption { text-align: start; font-weight: 700; margin-block-end: 8px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 12px; }
  th { background: #0f766e; color: #fff; text-align: start; }
  td.desc { text-align: start; }
  td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .footer { margin-block-start: 24px; color: #64748b; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <h1>ميترا — Metra</h1>
  <div class="descriptor">إدارة وتكاليف مشاريع التشطيبات · Project and cost control for fit-out contractors</div>

  <div class="mixed-line">غرفة المعيشة Living Room — 12 m² @ 1,250.00 EGP</div>

  <table dir="rtl">
    <caption>جدول الكميات (BOQ) — عينة</caption>
    <thead>
      <tr>
        <th>الوصف / Description</th>
        <th class="num">الكمية</th>
        <th class="num">سعر الوحدة (EGP)</th>
        <th class="num">الإجمالي (EGP)</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">الإجمالي الكلي / Grand Total</td>
        <td class="num">115,117.50</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">أُنشئ بواسطة ميترا · metra.app — Generated with Metra · metra.app</div>
</body>
</html>`;
}
