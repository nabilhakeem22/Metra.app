// What the Payments tab says about "left to bill" (A4 F11). PURE and
// CLIENT-SAFE. The balance itself can go below zero (an approved de-scope after
// instalments were sent), and the money is right, but "left to bill: -30,752"
// reads as nonsense: the tab says 0 and that the contract is already covered.
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';

/** How a bill compares with what is left: inside it, past it, or the contract already fully billed. */
export type BalanceFit = 'within' | 'over' | 'covered';

/** "Left to bill" as shown: never below zero. */
export function leftToBillShown(balance: string): string {
  return parseMoney4(balance) > 0n ? balance : '0.0000';
}

export function balanceFit(amount: string, balance: string): BalanceFit {
  if (parseMoney4(balance) <= 0n) return 'covered';
  return parseMoney4(amount) > parseMoney4(balance) ? 'over' : 'within';
}
