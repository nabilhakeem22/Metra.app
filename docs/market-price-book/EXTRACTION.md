# Extraction brief: the monthly building-materials bulletin (v1)

How a Claude Code session turns one month of the Ministry of Housing's building-materials
price bulletin (نشرة أسعار مواد البناء, MHUC Central Administration for Building Materials)
into the normalised file `metra.market-bulletin.v1`. The owner starts a session with:

> Read docs/market-price-book/EXTRACTION.md, then extract <PDF path> (and <MD path>) for period YYYY-MM.

The session is the **producer**. It reads, transcribes and writes one file. It never computes
a price, never writes to a database and **never runs `market:publish`**. The repo's
`market:check` is the gate; the owner approves what passes it.

Brief version: **EXTRACTION.md v1**. Put it in `producedBy`.

## 1. Goal and output

Produce exactly one file, `<staging>/<YYYY-MM>/bulletin.json` (or part files, section 7), where
`<staging>` is `MARKET_STAGING_DIR` or `.market-staging/` at the repo root (gitignored).

The source priority:

1. **The PDF page images are the primary source.** Every value is read from the rendered page.
2. **The MD conversion is a hint only**: use it to find pages quickly and as a cross-check.
   Its Arabic is reversed, its months collapse and its numbers merge (section 4, rules R1 to R8).
3. If, and only if, no PDF was handed over, read from the MD (`readFrom: "md"`). Expect a much
   longer confirmation list for the owner.

Steps:

1. Hash the source files exactly as received: `sha256sum <file>` (Git Bash) or
   `python -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" <file>`.
2. Render the PDF, the same way every month:
   `python packages/market-ingest/scripts/render-pages.py <pdf> .market-staging/<YYYY-MM>/pages --text`
   (needs PyMuPDF). It writes `p001.png` .. `pNNN.png` at 110 dpi and the PDF's text layer as
   `pNNN.txt`. The text layer is a **locating hint, never a value source**. If a cell is hard to
   read, re-render that page alone with `--pages N --dpi 200`.
3. Read the existing catalogue when one exists: `npm run market:catalogue` writes
   `<staging>/catalogue.json` (it needs the database; if you have no `DATABASE_URL`, the owner
   hands you the file). **Reuse every existing key** for the same item. For the very first
   bulletin there is no catalogue: mint keys (section 3).
4. Open the page images with the Read tool, 1 to 3 pages per call, and transcribe page by page.
5. Write the file, then run
   `npm run market:check -- --period YYYY-MM --pdf <pdf> --md <md>`
   (add `--offline` when there is no database). Fix everything a producer can fix. Re-run until
   only the owner's items remain.
6. Hand over: the path of the file, the `market:check` summary, and the **confirm list** (every
   B9 and F10 row: page, row, what you saw, what you chose, why).

### The format (normative: `packages/market-ingest/src/format.ts`, copied here verbatim)

```ts
export const MARKET_BULLETIN_FORMAT = 'metra.market-bulletin.v1';

/** `^[0-9]+(\.[0-9]{1,4})?$`: Western digits, no grouping, no sign. */
export type Decimal = string;

/** One month: a price, an empty cell, or a «التسعير متوقف» stamp. */
export type Slot = Decimal | null | 'suspended';

/** Index 0 = January. Twelve slots, always. */
export type Months = [Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot];

/** One cell's text exactly as printed, Jan..Dec. Arabic-Indic digits are allowed HERE ONLY. */
export type VerbatimCells = [
  string | null, string | null, string | null, string | null, string | null, string | null,
  string | null, string | null, string | null, string | null, string | null, string | null,
];

export type ReadFrom = 'pdf' | 'md';

export type Confidence = 'read' | 'inferred' | 'unreadable';

/** The reading rules of the brief; a non-`read` row must cite one. */
export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'] as const;

export interface MarketBulletinFileV1 {
  format: typeof MARKET_BULLETIN_FORMAT;
  publisher: 'mhuc_cabm';
  /** 'YYYY-MM', the bulletin month. */
  period: string;
  source: SourceV1;
  /** Which file the values were READ from. The other one, when given, was only a hint. */
  readFrom: ReadFrom;
  /** Free text, e.g. 'Claude Code session 2026-10-20, EXTRACTION.md v1'. */
  producedBy: string;
  /** One per PRICE page, ascending page. */
  pages: PageV1[];
  /** Directories, covers, TOC: with `pages`, they account for every page exactly once. */
  skippedPages: SkippedPageV1[];
}

export interface SourceV1 {
  pdfFileName: string | null;
  /** sha256 of the PDF exactly as received. */
  pdfSha256: string | null;
  /** The PDF's page count (145 for July 2026). Required with a PDF. */
  pdfPageCount: number | null;
  mdFileName: string | null;
  /** sha256 of the MD exactly as received. */
  mdSha256: string | null;
  /** The highest page number printed under a PRICE table (113 for July 2026). */
  lastPrintedPage: number;
}

export interface PageV1 {
  /** 1-based page index in the PDF. Required when readFrom = 'pdf'. */
  pdfPage: number | null;
  /** The number printed under the table. Required when readFrom = 'md'. NOT unique in a PDF. */
  printedPage: number | null;
  /** A taxonomy leaf, e.g. 'raw.cement'. */
  subCategoryKey: string;
  /** Page title in logical order, e.g. 'الأسمنت'. */
  headingAr: string;
  /** The unit cell when one unit spans all rows, e.g. 'طن'. */
  defaultUnitLabelAr: string | null;
  /** The price-basis line, logical order. */
  basisNoteAr: string;
  basis: { includesTaxes: boolean; includesTransport: boolean; minimumQuantityAr: string | null };
  /** e.g. 'التسعير متوقف نظرا للظروف الاقتصادية'. */
  suspendedNoteAr: string | null;
  /** The item names under the chart, logical order: the row-count cross-check. */
  legendLabelsAr: string[];
  rows: RowV1[];
  /** The '2025-2026 change' side table, when the page has one. */
  yearly: YearlyV1 | null;
}

export interface SkippedPageV1 {
  pdfPage: number | null;
  printedPage: number | null;
  reason: string;
}

export interface RowV1 {
  /** 'p<page>.r<n>': page = pdfPage when readFrom = 'pdf', else printedPage; n from 1, top to bottom. */
  rowId: string;
  /** `^[a-z0-9_]+(\.[a-z0-9_]+){2,}$`, starts with subCategoryKey; REUSE the catalogue key. */
  proposedKey: string;
  labelAr: string;
  specAr: string | null;
  nameEn: string;
  specEn: string | null;
  /** The unit for THIS row, logical order, Western digits (copy defaultUnitLabelAr when shared). */
  unitLabelAr: string;
  /** The 2026 table only, Western digits. */
  months: Months;
  /** The cells as printed. Required when readFrom = 'pdf'. */
  verbatimCells: VerbatimCells | null;
  /** The exact MD fragment the values came from. Required when readFrom = 'md'. */
  mdTokens: string | null;
  confidence: Confidence;
  /** Required unless 'read': the brief rule (R1..R10) that decided. */
  rule: string | null;
  notes: string | null;
}

export interface YearlyV1 {
  /** The charted row this table describes. */
  rowId: string;
  /** The previous-year column. */
  previousYear: Months;
  /** 12 entries as printed ('23', '-8', '2.4'); null where blank. */
  printedPct: (string | null)[];
  /** The printed 'المتوسط' (the PREVIOUS-year average). */
  printedAverage: Decimal | null;
}
```

Field rules the checker enforces:

- A value is **copied** from the page. It is never computed, never derived from a percentage,
  never carried forward from another month and never "corrected" to agree with a chart.
- Values (`months`, `previousYear`, `printedAverage`) use **Western digits** and a dot:
  `"39850"`, `"30.455"`. No grouping, no sign, at most 4 decimals.
- `verbatimCells` holds each cell **exactly as printed**, Arabic-Indic digits and «،» included:
  `"١٠،٣٧٤"`. It is required when `readFrom` is `"pdf"`. The checker re-reads every cell and
  refuses (B12) a value that is not what its cell says. An empty cell is `null` in both arrays.
- Every Arabic text studios will see (`headingAr`, `labelAr`, `specAr`, `unitLabelAr`,
  `basisNoteAr`, `minimumQuantityAr`, `suspendedNoteAr`) is in logical order with **Western
  digits** and no em or en dash (write a hyphen).
- `confidence: "read"` means the value is plainly legible on the page and no alignment, split
  or naming decision was needed.
- Any decision is `"inferred"` with `rule` naming the brief rule (`"R6"`, or `"R6, R1"`).
- A value you cannot determine is `null`; the row is `"unreadable"` (or `"inferred"` when its
  other values are certain), and `notes` says why. Never guess.

## 2. Page anatomy

Each **price page** of the PDF has, top to bottom:

- the running header «نشرة أسعار مواد البناء 2026» and the ministry logo;
- the **2026 month table**: the item column «النوع» at the right, then «الوحدة» (unit), then
  **January to December running right to left** (يناير is next to the unit column, ديسمبر is at
  the far left). Months after the bulletin month are empty cells;
- the **price-basis line** in the coloured band under the table, e.g.
  «الأسعار من قوائم بعض الشركات المنتجة - الأسعار شاملة الضرائب دون النقل»;
- a chart whose legend lists every row's name (`legendLabelsAr`, the row-count cross-check);
- often a **side table «معدل تغير الأسعار بين عامي 2025-2026»** for ONE charted row: the 2025
  price per month («السعر»), the printed % per month («معدل التغير») and «المتوسط», which is the
  **2025 average**, not a 2026 figure;
- a description box (ignore it) and the printed page number at the bottom.

**Skipped pages** go in `skippedPages` with a reason: the cover, the introduction and table of
contents, the section covers (a full-page title such as «المواد العازلة»), and the **company
directories** (tables of names, phones, addresses) that close each category.

**Page numbers.** With a PDF, a page is identified by its **PDF page index** (`pdfPage`, the
`pNNN` of the image); `printedPage` is recorded when printed. Printed numbers are NOT unique:
in July 2026 the directories on PDF pages 43 to 45 print 15 to 17, and those on 92 to 95 print
70 to 73, the same numbers as price pages. `rowId` is `p<pdfPage>.r<n>`. Coverage (B8) is checked
over PDF pages `1..pdfPageCount`. When reading from the MD only, pages are identified by the
printed number and coverage runs over `1..lastPrintedPage`.

## 3. Keys, names and the taxonomy

- `subCategoryKey` is a leaf of `packages/market-ingest/src/taxonomy.ts` (for example
  `raw.cement`, `finishing.glass`, `electrical.wires`). Pick the leaf from the page's side title
  and the bulletin's table of contents. A page that fits no leaf: stop and tell the owner (the
  taxonomy changes by PR, never in a session).
- `proposedKey` is `<subCategoryKey>.<slug>`: lowercase ASCII, digits and `_`, from the English
  name and the spec: `finishing.glass.clear_4mm`, `raw.cement.portland_ordinary_bagged`,
  `electrical.wires.copper_insulated_2mm`. **Reuse the catalogue key** whenever the item already
  exists, even if this month's wording differs a little.
- `labelAr` is the item name; `specAr` the size or grade («2 مم», «30x30x3 سم»).
- `nameEn` / `specEn`: a plain English name the owner reviews in review.html.
- `unitLabelAr` is the row's unit as printed, in logical order with Western digits. The map in
  `src/units.ts` must know it (B3): طن, كجم, م2, م3, متر طولي / م.ط, لتر, عدد, اللوح, عود,
  شيكارة, «اللفة (100 م.ط)». An unknown unit: stop and tell the owner.

## 4. Reading rules

**Digits.** The PDF prints Arabic-Indic digits: ٠ ١ ٢ ٣ ٤ ٥ ٦ ٧ ٨ ٩ = 0 1 2 3 4 5 6 7 8 9.
The comma-shaped mark «،» (or «٫») inside a number is the **decimal point**: «١١،١» = 11.1,
«١٦٣،٣٦» = 163.36, «١٠،٣٧٤» = 10.374. The bulletin prints **no thousands separator**:
«٣٩٨٥٠» = 39850. A number with two marks is not a value you can transcribe: mark the row
`unreadable` and say so in `notes`. Percentages print as «%٤» = 4, «%٨-» = -8, «%٢،٠» = 2.0.

- **R1 Month order.** PDF tables run January to December from right to left. In the MD's
  "picture text" rows the numbers come latest month first: assign the leftmost number to the
  bulletin month and walk back to January.
- **R2 Arabic order.** Write every Arabic text in logical order. The MD reverses it character by
  character («ديحد يحالتسل» = «حديد التسليح»); rebuild it from the PDF or the chart legend.
- **R3 Tables and merged cells.** One unit cell may span several rows: every row it spans gets
  that unit (`defaultUnitLabelAr` only when one unit spans ALL rows). Labels and units broken
  across lines are joined. In MD tables the cells run December to January left to right, leading
  empty cells are future months.
- **R4 Noise.** Drop tokens that are neither numbers nor part of a label (MD: `a`, `|`, `ee`, `Po`,
  `Lf`, `SS`, `~~...~~`, `<br>`, `##`).
- **R5 Unit glued to a number** (MD: `طن38200`): split into the unit and the value.
- **R6 Merged numbers** (MD: a token far outside the row's range whose digits split into two
  plausible values, `912969`): split by the digit lengths of the same column's sibling rows.
  `inferred`, rule R6, and the PDF decides which half belongs to which row.
- **R7 Missing or ambiguous cells.** Never guess. With too few MD tokens, use the yearly table
  to anchor the charted row's alignment and apply it to siblings only when their change months
  agree; leave the rest `null`, `inferred` (or `unreadable` with no anchor). On the PDF, a cell
  you cannot read even at 200 dpi is `null` and the row `unreadable`.
- **R8 Yearly blanks.** A blank % cell, or an MD `-100%` leftover for a future month, is `null`.
- **R9 Suspension stamps.** A stamp «التسعير متوقف ...» printed across a table: set
  `suspendedNoteAr`. Mark a slot `"suspended"` only when the stamp clearly covers that month's
  column (its `verbatimCells` entry is the stamp's text); otherwise the row is `unreadable`.
- **R10 Names.** When the row label is only a size («2مم»), the item name comes from the page
  heading or the chart title («أسلاك نحاس معزول») and the size goes to `specAr`.

**Basis per page.** Read the basis line of every page; it changes from page to page.
`includesTaxes` is false when it says the prices exclude VAT («لا تشمل ضريبة القيمة المضافة»);
`includesTransport` is true when it includes transport («شاملة تكلفة النقل»);
`minimumQuantityAr` holds a quantity condition («لا تقل عن 30 طن»). The default is taxes in,
transport out, no minimum.

**Empty months.** An empty cell up to the bulletin month is `null` and still `read` when the
page plainly shows it empty. Do not fill it from the yearly %, from the month before, or from
the MD.

## 5. Worked examples (July 2026; PDF page = image `pNNN.png`)

| # | PDF page (printed) | What the page shows | Correct reading | Lesson |
|---|---|---|---|---|
| P1 | 12 (7) repair materials | four rows, one «كجم» cell spanning all four; first row «١٠،٣٧٤ ١٠،٣٧٤ ١١،١ ...» from January | `defaultUnitLabelAr` «كجم»; Jan 10.374, Feb 10.374, Mar to Jul 11.1; `verbatimCells[0]` «١٠،٣٧٤» | the comma is the decimal mark |
| P2 | 6 (1) rebar | «٣٨٢٠٠» Jan to Mar, «٣٩٨٥٠» Apr to Jul; basis «الأسعار للمستهلك لكميات لا تقل عن ٣٠طن شاملة الضرائب دون النقل»; yearly 2025 = 38200 every month, % 0,0,0,4,4,4,4, average 38200 | `minimumQuantityAr` «لا تقل عن 30 طن» (Western digits); `printedPct` "0","0","0","4","4","4","4"; 39850/38200 = 4.3 agrees with 4 | no thousands separator; the basis can carry a minimum |
| P3 | 9 (4) cement | basis «... متوسط الأسعار لكمية أكثر من ٣٠طن ... الاسعار شاملة تكلفة النقل وغير شامل مصاريف التعتيق»; yearly % «%٨-» for June | `includesTransport: true`, `minimumQuantityAr` «أكثر من 30 طن»; `printedPct[5]` "-8"; average 3710 is the 2025 mean | the basis differs per page; negative % |
| P4 | 11 (6) admixtures | July is an **empty cell on every row**; the yearly table still prints 17% for July | July `null`, rows `read` (the page shows it empty); never fill July from the 17% | an empty cell is data |
| P5 | 87 (65) glass | unit «م٢» for six rows; green reflective 6 mm reads 735, 735, 969, 912 x4; light-blue reflective 6 mm reads 775, 775, 1026, 969 x4 | unit "م2"; the March spike is real (the 3 mm row's yearly % for March is 35) | the MD merges these two rows and an MD-only reading guessed March the wrong way round: the PDF wins |
| P6 | 7 (2) steel sections | medium beams July «٥١٠٠٠» against a 2025 price «٣٨٥٠٠»; the yearly table prints «%٤٠» | keep 51000 (`read`); `market:check` flags F8 (32.5 computed, 40 printed) | the checker lists, it never fixes; neither do you |
| P7 | 140 (110) bridge bearings | the March column of all six rows is one merged cell «نظرا للظروف الاقتصادية التسعير متوقف»; other months read clearly («٨٧٢١», «١٥٩٦٠», «٢٩٨١١») | `suspendedNoteAr` set; March `"suspended"` on every row with the stamp text in `verbatimCells[2]`; unit «عدد» | R9 on the PDF is certain; in the MD the same page is unreadable |
| P8 | 55 (38) plastic paints | row 1 unit «كجم», rows 2 to 4 one merged «لتر» cell; yearly % «%٢،٠», «%٠،٤» | `defaultUnitLabelAr` null; row 1 "كجم", rows 2 to 4 "لتر"; `printedPct` "2.0", "0.4" | R3 merged unit cells; one-decimal % |
| P9 | 62 (43) copper wire | row labels «٢مم», «٣مم», «٤مم», «٦مم»; unit «اللفة (١٠٠م.ط)»; the yearly table describes the 4 mm row | `labelAr` «أسلاك نحاس معزول» from the description title, `specAr` "2 مم"...; unit "اللفة (100 م.ط)"; `yearly.rowId` "p62.r3" | R10; the charted row is not always row 1 |

MD-only readings of the same pages (for `readFrom: "md"`):

| # | MD fragment (abridged) | Correct reading | Rule |
|---|---|---|---|
| E1 | `39850 39850 39850 39850 38200 38200 طن38200 يحالتسل ديحد` | «حديد التسليح», طن, Jan to Mar 38200, Apr to Jul 39850 | R1, R2, R5 |
| E3 | `30.455 30.455 30.455 27.687 26.12 26.12 ...` (6 tokens, 7 months) | yearly % 0,0,6,17 anchors January: Jan 26.12 ... Jun 30.455, July `null`, `inferred` R7; July goes on the confirm list (the PDF shows it empty) | R7 |
| E4 | `912969 \| 912969 912969 \| 912969 \| 1026969 735775 \| 735775` | two rows merged; split by sibling digit lengths, both `inferred` R6, the PDF decides March | R6 |
| E7 | `31019 31019 31019 31019 متوقف 31019 31019`, `1596029811` x6 | the stamp hides the suspended month and two rows merged: `unreadable` without the PDF | R9, R6 |
| E10 | yearly `%100- 38200 سطسأغ` for August to December | `printedPct` `null` | R8 |

## 6. Self-check before handing over

- Every row: the count of non-empty cells on the page equals the non-null slots you wrote, and
  every `verbatimCells` entry is the printed text of that cell.
- Every page: `rows.length` equals the chart legend (`legendLabelsAr`); the basis line is read.
- Every charted row: your values against the printed yearly % (F8) and «المتوسط» (F9).
- `pages` and `skippedPages` cover every PDF page exactly once (B8).
- All values in Western digits; every Arabic text in logical order.
- `npm run market:check` shows no blocking finding a producer can fix. The remaining B9 rows,
  and every F10 row, are the owner's confirm list.

## 7. Large bulletins: part files and sub-agents

A month's MD is about 280 KB and its PDF about 145 pages: too much for one context. Split by
the 8 category sections (finishing, cladding, paints, electrical, pipes, insulation, raw, roads)
and give each to a sub-agent:

- each writes `<staging>/<YYYY-MM>/parts/<top-category>.json`, a full `metra.market-bulletin.v1`
  file with the **identical header** (`format`, `publisher`, `period`, `readFrom`, `source`) and
  only its own `pages` and `skippedPages`;
- the cover, introduction and table of contents go in exactly one part;
- `market:check` merges the parts (and refuses `bulletin.json` and parts side by side); a header
  mismatch is B0, a page in two parts is B8.

## 8. What happens next (not the session's job)

The owner resolves the confirm list with `corrections.json` (`{ rowId, month, value, reason }`,
a confirmed value or a confirmed empty cell `null`) and `mapping.json` (`map` a row to an
existing key, `skip` it, or `discontinue` an old key), runs `market:review`, reads review.html
and publishes with the approved hash. See docs/DEPLOY.md, "Monthly market bulletin".
