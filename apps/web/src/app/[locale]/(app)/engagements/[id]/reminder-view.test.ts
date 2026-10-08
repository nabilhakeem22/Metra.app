import { describe, expect, it } from 'vitest';
import type { DeliveryReminder } from '@/lib/engagements/reminder/prepare';
import { reminderViewOf } from './reminder-view';

const reminder = { defaultLocale: 'en' } as unknown as DeliveryReminder;

describe('reminderViewOf', () => {
  it('a loaded reminder is ready', () => {
    expect(reminderViewOf({ ok: true, data: reminder }, false)).toEqual({ status: 'ready', reminder });
  });

  it('each refusal with a way out has its own view', () => {
    expect(reminderViewOf({ ok: false, error: 'delivery_link_not_shared' }, false)).toEqual({ status: 'notShared' });
    expect(reminderViewOf({ ok: false, error: 'delivery_links_not_configured' }, false)).toEqual({
      status: 'notConfigured',
    });
    expect(reminderViewOf({ ok: false, error: 'delivery_link_unrecoverable' }, false)).toEqual({
      status: 'unrecoverable',
    });
  });

  it('a link still unrecoverable right after a replace is a failure, not another replace', () => {
    expect(reminderViewOf({ ok: false, error: 'delivery_link_unrecoverable' }, true)).toEqual({
      status: 'failed',
      error: 'delivery_link_unrecoverable',
    });
  });

  it('any other refusal, or none named, fails with its code', () => {
    expect(reminderViewOf({ ok: false, error: 'forbidden' }, false)).toEqual({ status: 'failed', error: 'forbidden' });
    expect(reminderViewOf({ ok: false }, false)).toEqual({ status: 'failed', error: 'generic' });
    expect(reminderViewOf({ ok: true }, false)).toEqual({ status: 'failed', error: 'generic' });
  });
});
