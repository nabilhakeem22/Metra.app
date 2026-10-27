'use client';

import { useEffect, useState, useTransition } from 'react';
import { codeBoxValue, CODE_LENGTH, type CodeAnswer, type CodeLimit, type CodePurpose } from '@/lib/client-home/code-answers';
import { isSharedPortalError, UNCONFIRMED_WRITE, type ShownPortalFailure } from '@/lib/share/portal-failure';
import { requestClientCode } from '../code-actions';

/**
 * Where a code would go, as the page knows it: the masked address (the
 * Execution tab reads it with the home), none on file, or `unknown` until a
 * code is asked for (the design tab's read does not carry it).
 */
export type KnownCodeChannel = { hint: string } | null | 'unknown';

/** What the code panel says went wrong: in its own words, or a shared portal failure. */
export type CodeNotice =
  | { error: 'code_wrong'; attemptsLeft: number }
  | { error: 'too_many'; limit: CodeLimit }
  | { error: 'code_incomplete' | 'code_locked' | 'code_expired' | 'code_used' | 'code_unknown' | 'busy' | 'requestBusy' | 'send_failed' }
  | { error: 'portal'; failure: ShownPortalFailure };

export interface ClientCode {
  /** The client has no address on file: no code can be sent, the panel says so. */
  noChannel: boolean;
  /** Where the code goes (or went), masked; null while the page does not know. */
  hint: string | null;
  /** The code box is open: a code was sent from this page, or the client has one from an email. */
  typing: boolean;
  /** A code was sent from this page in this visit: the panel says where it went. */
  sentHere: boolean;
  /** The code box, Latin digits only, at most six. */
  value: string;
  type: (typed: string) => void;
  /** Six digits are typed and no wait holds the act: it may be sent. */
  ready: boolean;
  /** A code request is in flight. */
  requesting: boolean;
  /** Seconds before another code may be asked for; 0 when it may now. */
  waitSeconds: number;
  /** What went wrong; a limit's notice goes once its wait is over (H5 functional F3). */
  notice: CodeNotice | null;
  /** Seconds the notice's wait still runs (a limit's), 0 for any other notice. */
  noticeSeconds: number;
  /** Ask for a code for the act; refused while one is in flight or a wait runs. */
  request: () => void;
  /** "I already have a code": open the code box without asking for one (a reload, the email's link). */
  haveCode: () => void;
  /** The code to send with the act, or null when there is none to send. */
  proof: () => { code: string } | null;
  /** Take an act's refusal that is about the code or a limit; true when it was one (the panel says it). */
  heard: (answer: CodeAnswer) => boolean;
}

/** An instant as epoch milliseconds, or null for none. */
type Until = number | null;

/**
 * The clock, ticking once a second while any of `deadlines` is in the future,
 * and stopping at the last. `restart` sets it to now at once, so a wait just
 * started is counted from the right instant on its first render.
 */
function useNow(deadlines: readonly Until[]): { now: number; restart: () => void } {
  const [now, setNow] = useState(() => Date.now());
  const latest = Math.max(0, ...deadlines.map((until) => until ?? 0));
  useEffect(() => {
    if (latest <= Date.now()) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= latest) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [latest]);
  return { now, restart: () => setNow(Date.now()) };
}

const secondsBetween = (now: number, until: Until) => (until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000)));

/**
 * The behaviour behind ONE act's code panel (./client-code-panel.tsx): ask
 * for a code for `target`, or say one is already in hand, type it, and read
 * what the act said about it. The browser keeps no code id: the database
 * checks the typed code against the newest code of the act (H5 functional
 * F1), so a client back from the email, or after a reload, types it and it
 * works. `target` is the act's subject (a payment request id, a milestone
 * kind), or null while no act is open; the panel starts over when it names a
 * different one, and keeps its state when the same one is opened again; it
 * opens on the code box for `typingFor` (the act a code email linked to).
 * `onGone`: the act can no longer be taken (the request moved on), so the
 * caller closes it. Every await is wrapped: a rejected request never strands
 * the spinner.
 */
export function useClientCode(
  token: string,
  purpose: CodePurpose,
  target: string | null,
  channel: KnownCodeChannel,
  onGone: () => void,
  typingFor: string | null = null,
): ClientCode {
  const [requesting, startTransition] = useTransition();
  const [forTarget, setForTarget] = useState(target);
  const [typing, setTyping] = useState(target !== null && target === typingFor);
  const [sentHint, setSentHint] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState<CodeNotice | null>(null);
  const [noticeUntil, setNoticeUntil] = useState<Until>(null);
  const [nextRequestAt, setNextRequestAt] = useState<Until>(null);
  const [actWaitUntil, setActWaitUntil] = useState<Until>(null);
  const [learntNoChannel, setLearntNoChannel] = useState(false);
  const { now, restart } = useNow([nextRequestAt, noticeUntil, actWaitUntil]);
  const waitSeconds = secondsBetween(now, nextRequestAt);
  const noticeSeconds = secondsBetween(now, noticeUntil);

  if (target !== null && target !== forTarget) {
    setForTarget(target);
    setTyping(target === typingFor);
    setSentHint(null);
    setValue('');
    setNotice(null);
    setNoticeUntil(null);
    setNextRequestAt(null);
    setActWaitUntil(null);
  }

  /** An instant `seconds` from now, the clock moved to now with it. */
  const after = (seconds: number) => {
    restart();
    return Date.now() + seconds * 1000;
  };

  /** Say what went wrong; a limit's notice carries its wait, any other none. */
  const say = (next: CodeNotice | null, waitSecondsOfNotice: number | null = null) => {
    setNotice(next);
    setNoticeUntil(waitSecondsOfNotice === null ? null : after(waitSecondsOfNotice));
  };

  const startOver = (next: CodeNotice) => {
    setTyping(false);
    setSentHint(null);
    setValue('');
    say(next);
  };

  function request() {
    if (target === null || requesting || waitSeconds > 0) return;
    say(null);
    startTransition(async () => {
      try {
        const answer = await requestClientCode(token, { purpose, target });
        if (answer.ok) {
          setTyping(true);
          setSentHint(answer.hint);
          setValue('');
          setNextRequestAt(after(answer.resendAfterSeconds));
          return;
        }
        switch (answer.error) {
          case 'no_channel':
            setLearntNoChannel(true);
            return;
          case 'not_available':
            onGone();
            return;
          case 'too_many':
            say({ error: 'too_many', limit: answer.limit }, answer.retryAfterSeconds);
            setNextRequestAt(after(answer.retryAfterSeconds));
            return;
          case 'busy':
            say({ error: 'requestBusy' });
            return;
          case 'send_failed':
            say({ error: 'send_failed' });
            // The failed send still holds its 60 s spacing (H5 functional F2): the countdown shows it.
            if (answer.resendAfterSeconds !== null) setNextRequestAt(after(answer.resendAfterSeconds));
            return;
          default: {
            // A dead or expired link, or a failure underneath: said as every link page says it.
            const { error } = answer;
            if (isSharedPortalError(error)) {
              say({ error: 'portal', failure: { error, reference: 'reference' in answer ? answer.reference : undefined } });
            }
          }
        }
      } catch {
        say({ error: 'portal', failure: UNCONFIRMED_WRITE });
      }
    });
  }

  function heard(answer: CodeAnswer): boolean {
    if (answer.ok) return false;
    switch (answer.error) {
      case 'code_wrong':
        if (answer.attemptsLeft === undefined) {
          say({ error: 'code_incomplete' });
        } else if (answer.attemptsLeft === 0) {
          startOver({ error: 'code_wrong', attemptsLeft: 0 });
        } else {
          setValue('');
          say({ error: 'code_wrong', attemptsLeft: answer.attemptsLeft });
        }
        return true;
      case 'code_locked':
      case 'code_expired':
      case 'code_used':
      case 'code_unknown':
        startOver({ error: answer.error });
        return true;
      case 'busy':
        say({ error: 'busy' });
        return true;
      case 'too_many':
        // The code was not used: the act stays open and waits (H5 weak spot 2).
        say({ error: 'too_many', limit: answer.limit }, answer.retryAfterSeconds);
        setActWaitUntil(after(answer.retryAfterSeconds));
        return true;
      default:
        return false;
    }
  }

  const shownNotice = notice?.error === 'too_many' && noticeSeconds === 0 ? null : notice;
  return {
    noChannel: channel === null || learntNoChannel,
    hint: sentHint ?? (channel !== null && channel !== 'unknown' ? channel.hint : null),
    typing,
    sentHere: sentHint !== null,
    value,
    type: (typed) => {
      setValue(codeBoxValue(typed));
      if (notice?.error === 'code_incomplete') say(null);
    },
    ready: typing && value.length === CODE_LENGTH && secondsBetween(now, actWaitUntil) === 0,
    requesting,
    waitSeconds,
    notice: shownNotice,
    noticeSeconds: shownNotice?.error === 'too_many' ? noticeSeconds : 0,
    request,
    haveCode: () => {
      setTyping(true);
      say(null);
    },
    proof: () => (typing && value.length === CODE_LENGTH ? { code: value } : null),
    heard,
  };
}
