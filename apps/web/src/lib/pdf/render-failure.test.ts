import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFailure } from './render-failure';
import { RendererBusyError } from './renderer-busy';

vi.mock('server-only', () => ({}));

const log = vi.spyOn(console, 'error');

beforeEach(() => {
  log.mockReset().mockImplementation(() => {});
});

describe('renderFailure (R5, F12)', () => {
  it('answers renderer_busy for the retryable busy failure', () => {
    expect(renderFailure(new RendererBusyError(), 'BOQ issue')).toEqual({ ok: false, error: 'renderer_busy' });
  });

  it('answers generic WITH the reference of its one log line for every other render failure', () => {
    for (const cause of [new Error('page crashed'), 'not even an error']) {
      log.mockClear();
      const answer = renderFailure(cause, 'BOQ issue');
      expect(answer).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(/^[0-9A-Z]{8}$/) });
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('BOQ issue render failed', expect.objectContaining({ reference: answer.reference }));
    }
  });
});
