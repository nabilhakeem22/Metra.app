// Variation-order input validation — PURE and CLIENT-SAFE (no db, no
// `server-only`), mirroring lib/proposals/validation.ts so the money rules
// standing between a pasted string and a numeric(18,4) column are unit-testable
// without a database.
/**
 * A variation-order quantity may be NEGATIVE — that is what a de-scope IS — and
 * an absent one is a zero. Everything else is the shared money rule.
 */
export const SIGNED_MONEY_FIELD = { allowNegative: true, blank: '0' } as const;
