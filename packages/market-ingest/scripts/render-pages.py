"""Render a bulletin PDF to one PNG per page, the same way every month.

    python packages/market-ingest/scripts/render-pages.py <bulletin.pdf> <out-dir> [--dpi 110] [--pages 12-14] [--text]

Writes <out-dir>/p001.png .. pNNN.png (1-based PDF page index, zero-padded to 3).
--pages renders a range only (re-render one page at --dpi 200 when a cell is hard
to read). --text also writes pNNN.txt, the PDF's own text layer: a HINT for
locating pages, never a source of values.

Needs PyMuPDF (`pip install pymupdf`). Local files only: no network.
"""
import argparse
import pathlib
import sys

import pymupdf


def page_range(spec, count):
    if spec is None:
        return range(1, count + 1)
    first, _, last = spec.partition('-')
    start, end = int(first), int(last or first)
    if not 1 <= start <= end <= count:
        sys.exit(f'render-pages FAILED: --pages {spec} is outside 1-{count}')
    return range(start, end + 1)


def main():
    parser = argparse.ArgumentParser(description='Render bulletin PDF pages to PNG.')
    parser.add_argument('pdf')
    parser.add_argument('out_dir')
    parser.add_argument('--dpi', type=int, default=110)
    parser.add_argument('--pages')
    parser.add_argument('--text', action='store_true')
    args = parser.parse_args()
    out = pathlib.Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(args.pdf)
    for number in page_range(args.pages, document.page_count):
        page = document[number - 1]
        page.get_pixmap(dpi=args.dpi).save(out / f'p{number:03d}.png')
        if args.text:
            (out / f'p{number:03d}.txt').write_text(page.get_text(), encoding='utf-8')
    print(f'rendered {len(page_range(args.pages, document.page_count))} of {document.page_count} pages to {out}')


if __name__ == '__main__':
    main()
