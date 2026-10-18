import { describe, expect, it } from 'vitest';
import { isDriverWriteAfterClose } from './driver-close-guard';

// The one uncaught driver failure the CLI ignores: postgres.js writing to a
// connection the server already closed (seen on a Linux-style close after a
// terminated backend). Everything else stays fatal.

function typeError(message: string, stack: string): TypeError {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n${stack}`;
  return error;
}

const DRIVER_FRAMES = '    at Immediate.nextWrite (file:///repo/node_modules/postgres/src/connection.js:255:22)\n    at process.processImmediate (node:internal/timers:504:21)';

describe('the driver write-after-close guard', () => {
  it("recognises postgres.js's null-socket write, with either path separator", () => {
    expect(isDriverWriteAfterClose(typeError("Cannot read properties of null (reading 'write')", DRIVER_FRAMES))).toBe(true);
    expect(isDriverWriteAfterClose(typeError("Cannot read properties of null (reading 'write')", DRIVER_FRAMES.replace('/postgres/src/connection.js', '\\postgres\\src\\connection.js')))).toBe(true);
  });

  it('leaves every other uncaught error fatal: another message, another module, not a TypeError', () => {
    expect(isDriverWriteAfterClose(typeError("Cannot read properties of null (reading 'end')", DRIVER_FRAMES))).toBe(false);
    expect(isDriverWriteAfterClose(typeError("Cannot read properties of null (reading 'write')", '    at nextWrite (file:///repo/src/seed/run.ts:1:1)'))).toBe(false);
    expect(isDriverWriteAfterClose(Object.assign(new Error("Cannot read properties of null (reading 'write')"), { stack: DRIVER_FRAMES }))).toBe(false);
    expect(isDriverWriteAfterClose('a string')).toBe(false);
  });
});
