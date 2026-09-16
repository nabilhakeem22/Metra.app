/**
 * The caps a priced document made of sections and lines obeys.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no 'use client' — the
 * builder's client-side guard and the server core must agree on one number.
 *
 * These lived in `lib/proposals/validation.ts`, which made `contracts`,
 * `variations` and `boqs` import the PROPOSALS module to learn how many lines a
 * contract may hold. Sections and lines are not a proposal idea; they belong to
 * every priced document Metra writes, so the caps live in a neutral kernel.
 */

/** Sections per document. */
export const MAX_SECTIONS = 100;

/** Lines inside one section. */
export const MAX_LINES_PER_SECTION = 500;

/** Lines across the whole document. Also the clamp the money engine assumes
 *  when it bounds accumulated rounding error (see `aggregates/proposal-totals`). */
export const MAX_TOTAL_LINES = 2000;

/** Rows per INSERT when persisting lines. Postgres' bind-parameter ceiling is
 *  65,535, and a line row carries ~15 columns, so 500 rows (~7,500 parameters)
 *  stays an order of magnitude clear of it. */
export const LINE_INSERT_CHUNK = 500;
