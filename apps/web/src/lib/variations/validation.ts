// Variation-order input validation — PURE and CLIENT-SAFE (no db, no
// `server-only`), so the money rule standing between a pasted string and a
// numeric(18,4) column is unit-testable without a database. MODULE-SPECIFIC by
// design: the shared readers live in lib/money and lib/validation.
/**
 * A variation-order quantity may be NEGATIVE — that is what a de-scope IS — and
 * an absent one is a zero. Everything else is the shared money rule.
 */
export const SIGNED_MONEY_FIELD = { allowNegative: true, blank: '0' } as const;
