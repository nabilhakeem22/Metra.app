// The selling price the seed sets: cost x 1.05 (the owner's 5% margin), exact
// at the price book's scale of 4 decimal places (numeric(18,4)), rounded half
// up. BigInt, never float.
const SCALE = 10_000n;

function scaled(decimal: string): bigint {
  const [whole, fraction = ''] = decimal.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0').slice(0, 4));
}

function format(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
}

/** A non-negative decimal, canonical at 4 decimal places: '30.455' -> '30.4550'. */
export function atPriceBookScale(decimal: string): string {
  return format(scaled(decimal));
}

/** cost x 105 / 100, half up at 4 decimal places: '30.455' -> '31.9778'. */
export function withFivePercentMargin(cost: string): string {
  const numerator = scaled(cost) * 105n;
  const quotient = numerator / 100n;
  return format(numerator % 100n >= 50n ? quotient + 1n : quotient);
}
