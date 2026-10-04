import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFailureCode } from './render-failure-code';
import { RendererBusyError } from './renderer-busy';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('renderFailureCode (R5)', () => {
  it('answers renderer_busy for the retryable busy failure', () => {
    expect(renderFailureCode(new RendererBusyError(), 'BOQ issue')).toBe('renderer_busy');
  });

  it('answers generic for every other render failure', () => {
    expect(renderFailureCode(new Error('page crashed'), 'BOQ issue')).toBe('generic');
    expect(renderFailureCode('not even an error', 'BOQ issue')).toBe('generic');
  });
});
