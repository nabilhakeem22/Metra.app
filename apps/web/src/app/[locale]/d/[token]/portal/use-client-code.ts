'use client';

import { useEffect, useState, useTransition } from 'react';
import { codeBoxValue, CODE_LENGTH, type CodeAnswer, type CodePurpose } from '@/lib/client-home/code-answers';
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
  | { error: 'too_many'; retryAfterSeconds: number }
  | { error: 'code_incomplete' | 'code_locked' | 'code_expired' | 'code_used' | 'code_unknown' | 'busy' | 'requestBusy' | 'send_failed' }
  | { error: 'portal'; failure: ShownPortalFailure };

export interface ClientCode {
  /** The client has no address on file: no code can be sent, the panel says so. */
  noChannel: boolean;
  /** Where the code goes (or went), masked; null while the page does not know. */
  hint: string | null;
  /** A code was sent for this act and may still be typed. */
  sent: boolean;
  /** The code box, Latin digits only, at most six. */
  value: string;
  type: (typed: string) => void;
  /** A code was sent and six digits are typed: the act may be sent. */
  ready: boolean;
  /** A code request is in flight. */
  requesting: boolean;
  /** Seconds before another code may be asked for; 0 when it may now. */
  waitSeconds: number;
  notice: CodeNotice | null;
  /** Ask for a code for the act; refused while one is in flight or a wait runs. */
  request: () => void;
  /** The code to send with the act, or null when there is none to send. */
  proof: () => { challengeId: string; code: string } | null;
  /** Take an act's refusal that is about the code; true when it was one (the panel says it). */
  heard: (answer: CodeAnswer) => boolean;
}

interface SentChallenge {
  challengeId: string;
  hint: string;
}

/** Ticks once a second while `until` is in the future; the seconds left, else 0. */
function useSecondsUntil(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * The behaviour behind ONE act's code panel (./client-code-panel.tsx): ask
 * for a code for `target`, type it, and read what the act said about it.
 * `target` is the act's subject (a payment request id, a milestone kind), or
 * null while no act is open; the panel starts over when it names a different
 * one, and keeps a sent code when the same one is opened again. `onGone`: the
 * act can no longer be taken (the request moved on), so the caller closes it.
 * Every await is wrapped: a rejected request never strands the spinner.
 */
export function useClientCode(
  token: string,
  purpose: CodePurpose,
  target: string | null,
  channel: KnownCodeChannel,
  onGone: () => void,
): ClientCode {
  const [requesting, startTransition] = useTransition();
  const [forTarget, setForTarget] = useState(target);
  const [challenge, setChallenge] = useState<SentChallenge | null>(null);
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState<CodeNotice | null>(null);
  const [nextRequestAt, setNextRequestAt] = useState<number | null>(null);
  const [learntNoChannel, setLearntNoChannel] = useState(false);
  const waitSeconds = useSecondsUntil(nextRequestAt);

  if (target !== null && target !== forTarget) {
    setForTarget(target);
    setChallenge(null);
    setValue('');
    setNotice(null);
    setNextRequestAt(null);
  }

  const startOver = (next: CodeNotice) => {
    setChallenge(null);
    setValue('');
    setNotice(next);
  };

  function request() {
    if (target === null || requesting || waitSeconds > 0) return;
    setNotice(null);
    startTransition(async () => {
      try {
        const answer = await requestClientCode(token, { purpose, target });
        if (answer.ok) {
          setChallenge({ challengeId: answer.challengeId, hint: answer.hint });
          setValue('');
          setNextRequestAt(Date.now() + answer.resendAfterSeconds * 1000);
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
            setNotice({ error: 'too_many', retryAfterSeconds: answer.retryAfterSeconds });
            setNextRequestAt(Date.now() + answer.retryAfterSeconds * 1000);
            return;
          case 'busy':
            setNotice({ error: 'requestBusy' });
            return;
          case 'send_failed':
            setNotice({ error: 'send_failed' });
            return;
          default: {
            // A dead or expired link, or a failure underneath: said as every link page says it.
            const { error } = answer;
            if (isSharedPortalError(error)) {
              setNotice({ error: 'portal', failure: { error, reference: 'reference' in answer ? answer.reference : undefined } });
            }
          }
        }
      } catch {
        setNotice({ error: 'portal', failure: UNCONFIRMED_WRITE });
      }
    });
  }

  function heard(answer: CodeAnswer): boolean {
    if (answer.ok) return false;
    switch (answer.error) {
      case 'code_wrong':
        if (answer.attemptsLeft === undefined) {
          setNotice({ error: 'code_incomplete' });
        } else if (answer.attemptsLeft === 0) {
          startOver({ error: 'code_wrong', attemptsLeft: 0 });
        } else {
          setValue('');
          setNotice({ error: 'code_wrong', attemptsLeft: answer.attemptsLeft });
        }
        return true;
      case 'code_locked':
      case 'code_expired':
      case 'code_used':
      case 'code_unknown':
        startOver({ error: answer.error });
        return true;
      case 'busy':
        setNotice({ error: 'busy' });
        return true;
      default:
        return false;
    }
  }

  return {
    noChannel: channel === null || learntNoChannel,
    hint: challenge?.hint ?? (channel !== null && channel !== 'unknown' ? channel.hint : null),
    sent: challenge !== null,
    value,
    type: (typed) => {
      setValue(codeBoxValue(typed));
      if (notice?.error === 'code_incomplete') setNotice(null);
    },
    ready: challenge !== null && value.length === CODE_LENGTH,
    requesting,
    waitSeconds,
    notice,
    request,
    proof: () => (challenge && value.length === CODE_LENGTH ? { challengeId: challenge.challengeId, code: value } : null),
    heard,
  };
}
