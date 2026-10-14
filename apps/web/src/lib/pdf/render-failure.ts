// What a core that renders a PDF answers when the render throws: the coded twin
// of `responses.ts#renderFailure`, for server actions rather than routes. A busy
// renderer is RETRYABLE and says so; anything else is an unexpected failure the
// studio can quote (its reference finds the one log line). Neither has written
// anything: every caller renders first.
import { err, type ActionResult } from '@/lib/actions/result';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { RendererBusyError } from './renderer-busy';

export function renderFailure(cause: unknown, logLabel: string): ActionResult {
  if (cause instanceof RendererBusyError) {
    console.error(`${logLabel} PDF renderer busy:`, loggableFailure(cause));
    return err('renderer_busy');
  }
  return unexpectedFailure(`${logLabel} render failed`, cause);
}
