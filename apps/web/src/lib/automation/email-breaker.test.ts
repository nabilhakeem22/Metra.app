import { describe, expect, it, vi } from 'vitest';
import { createEmailBreaker, EMAIL_BREAKER_LIMIT } from './email-breaker';
import { emailEachRecipient, emailRecipient, OWNER_EMAIL_CONCURRENCY } from './email-delivery';
import type { AutomationResult, RecipientEmailLookup } from './types';

const found: RecipientEmailLookup = async (userId) => ({ status: 'found', email: `${userId}@studio.test` });
const result = (): AutomationResult => ({ automation: 'digest', ran: true, effects: 0, emailsSent: 0, emailsFailed: 0 });

describe('the per-tick email breaker (R2)', () => {
  it('opens after the limit of consecutive transient failures, logs once, and then sends nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const breaker = createEmailBreaker();
    const send = vi.fn(async () => ({ sent: false, transient: true }));
    for (let i = 0; i < EMAIL_BREAKER_LIMIT; i += 1) {
      expect(await emailRecipient(found, `u${i}`, send, breaker)).toBe('failed');
    }
    expect(breaker.open).toBe(true);
    const lookup = vi.fn(found);
    expect(await emailRecipient(lookup, 'late', send, breaker)).toBe('failed');
    expect(lookup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(EMAIL_BREAKER_LIMIT);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a success resets the count; a member with no address counts nowhere', async () => {
    const breaker = createEmailBreaker(2);
    breaker.record('failed', true);
    breaker.record('sent', false);
    breaker.record('failed', true);
    breaker.record('no-address', false);
    expect(breaker.open).toBe(false);
    breaker.record('failed', true);
    expect(breaker.open).toBe(true);
  });

  it('4xx refusals (an unverified sending domain) never open it, and the owner still gets their email', async () => {
    const breaker = createEmailBreaker();
    const refused = vi.fn(async () => ({ sent: false, transient: false }));
    for (let i = 0; i < EMAIL_BREAKER_LIMIT * 4; i += 1) {
      expect(await emailRecipient(found, `colleague-${i}`, refused, breaker)).toBe('failed');
    }
    expect(breaker.open).toBe(false);
    const accepted = vi.fn(async () => ({ sent: true }));
    expect(await emailRecipient(found, 'owner', accepted, breaker)).toBe('sent');
    expect(accepted).toHaveBeenCalledWith('owner@studio.test');
  });

  it('a refusal neither counts nor resets: transient failures on either side of it still add up', async () => {
    const breaker = createEmailBreaker(2);
    breaker.record('failed', true);
    breaker.record('failed', false);
    expect(breaker.open).toBe(false);
    breaker.record('failed', true);
    expect(breaker.open).toBe(true);
  });

  it('a recipient lookup that failed or timed out counts as transient', async () => {
    const breaker = createEmailBreaker(1);
    const lookupFailed: RecipientEmailLookup = async () => ({ status: 'failed' });
    expect(await emailRecipient(lookupFailed, 'u', vi.fn(), breaker)).toBe('failed');
    expect(breaker.open).toBe(true);
  });
});

describe('emailEachRecipient', () => {
  it(`sends an org's owner and admin emails ${OWNER_EMAIL_CONCURRENCY} at a time and counts each`, async () => {
    let inFlight = 0;
    let peak = 0;
    const send = vi.fn(async (to: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { sent: !to.startsWith('bad') };
    });
    const tally = result();
    await emailEachRecipient(
      { lookupRecipientEmail: found, emailBreaker: createEmailBreaker() },
      ['a', 'b', 'bad', 'c'],
      send,
      tally,
    );
    expect(peak).toBe(OWNER_EMAIL_CONCURRENCY);
    expect(tally).toMatchObject({ emailsSent: 3, emailsFailed: 1 });
  });
});
