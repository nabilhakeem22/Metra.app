// A bounded WAIT on work that is not ours to cancel: whether `work` settled
// (resolved or rejected) within `ms`. Pure and client-safe. The timer is
// always cleared, so a fast settle never keeps an isolate alive, and the work
// itself goes on either way: this bounds the wait, never the work.

/** True when `work` settled within `ms`. Never rejects. */
export function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([work.then(() => true, () => true), late]).finally(() => clearTimeout(timer));
}
