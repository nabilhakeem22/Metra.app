// The studio profile's text caps. PURE and CLIENT-SAFE: the server refuses past
// them (core.ts profileWithinLimits) and the onboarding form stops typing at them,
// from this one table. Lengths are UTF-16 code units, which is what both
// String.length and an input's maxLength count.
export const ORG_PROFILE_LIMITS = { name: 200, city: 120, taxReg: 64 } as const;
