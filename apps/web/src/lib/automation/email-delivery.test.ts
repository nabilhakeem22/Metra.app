import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countEmailOutcome, emailRecipient } from './email-delivery';
import type { AutomationResult, RecipientLookup } from './types';

const USER = 'user-1';

function lookupReturning(answer: RecipientLookup) {
  return vi.fn(async () => answer);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('emailRecipient', () => {
  it('sends to the address it found', async () => {
    const send = vi.fn(async () => ({ sent: true }));
    const outcome = await emailRecipient(
      lookupReturning({ status: 'found', email: 'a@b.example' }),
      USER,
      send,
    );
    expect(outcome).toBe('sent');
    expect(send).toHaveBeenCalledWith('a@b.example');
  });

  it('reports a refused send as failed', async () => {
    const outcome = await emailRecipient(
      lookupReturning({ status: 'found', email: 'a@b.example' }),
      USER,
      async () => ({ sent: false }),
    );
    expect(outcome).toBe('failed');
  });

  it('counts a failed or timed-out lookup as a failed email, without sending', async () => {
    const send = vi.fn(async () => ({ sent: true }));
    const outcome = await emailRecipient(lookupReturning({ status: 'failed' }), USER, send);
    expect(outcome).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a user with no address, without sending', async () => {
    const send = vi.fn(async () => ({ sent: true }));
    const outcome = await emailRecipient(lookupReturning({ status: 'no-address' }), USER, send);
    expect(outcome).toBe('no-address');
    expect(send).not.toHaveBeenCalled();
  });

  it('never throws out of the core, even if a sender breaks its contract', async () => {
    const outcome = await emailRecipient(
      lookupReturning({ status: 'found', email: 'a@b.example' }),
      USER,
      async () => {
        throw new Error('template exploded');
      },
    );
    expect(outcome).toBe('failed');
    expect(console.error).toHaveBeenCalledWith(
      'automation email send threw:',
      expect.objectContaining({ message: 'template exploded' }),
    );
  });
});

describe('countEmailOutcome', () => {
  it('tallies sent and failed, and leaves no-address uncounted', () => {
    const result: AutomationResult = {
      automation: 'digest',
      ran: true,
      effects: 0,
      emailsSent: 0,
      emailsFailed: 0,
    };
    for (const outcome of ['sent', 'sent', 'failed', 'no-address'] as const) {
      countEmailOutcome(result, outcome);
    }
    expect(result).toMatchObject({ emailsSent: 2, emailsFailed: 1 });
  });
});
