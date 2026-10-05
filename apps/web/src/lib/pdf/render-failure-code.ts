// What a core that renders a PDF answers when the render throws: the coded twin
// of `responses.ts#renderFailure`, for server actions rather than routes. A busy
// renderer is RETRYABLE and says so; anything else is a generic failure. Both
// are logged, and neither has written anything (every caller renders first).
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { ActionCode } from '@/lib/actions/result';
import { RendererBusyError } from './renderer-busy';

export function renderFailureCode(cause: unknown, logLabel: string): ActionCode {
  if (cause instanceof RendererBusyError) {
    console.error(`${logLabel} PDF renderer busy:`, loggableFailure(cause));
    return 'renderer_busy';
  }
  console.error(`${logLabel} render failed:`, loggableFailure(cause));
  return 'generic';
}
