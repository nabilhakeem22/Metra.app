// The studio profile's text caps. PURE and CLIENT-SAFE: the server refuses past
// them (./profile-field-rules.ts) and the onboarding form stops typing at them,
// from this one table. The input's maxLength counts UTF-16 units and the rule
// counts characters (code points), so the input is never looser than the rule.
export const ORG_PROFILE_LIMITS = { name: 200, city: 120, taxReg: 64 } as const;
