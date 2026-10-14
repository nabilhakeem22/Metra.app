// How many client messages on ONE document thread wait for the studio: those
// with no staff message after them. The same rule as countAwaitingReplyCore,
// applied to a thread already in hand. Pure and client-safe.

export function unansweredClientMessages(
  messages: readonly { channel: string; createdAt: Date | string }[],
): number {
  const lastStaffAt = messages.reduce<number>(
    (latest, message) =>
      message.channel === 'staff' ? Math.max(latest, new Date(message.createdAt).getTime()) : latest,
    0,
  );
  return messages.filter(
    (message) => message.channel === 'client' && new Date(message.createdAt).getTime() > lastStaffAt,
  ).length;
}
