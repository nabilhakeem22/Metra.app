'use client';

import { type CSSProperties, Fragment, useEffect, useRef, useState } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * One line that comes into focus word by word the first time it scrolls into
 * view. The unit is the WORD, never the letter, so Arabic keeps its joins.
 *
 * The resting markup is the plain, sharp sentence: the words are inline spans
 * separated by real spaces, so it reads as one sentence to a screen reader and
 * to a crawler, and stays readable with no script at all. Only the class added
 * here, right before the animation, blurs the words; under reduced motion it is
 * never added.
 */
export function WordReveal({ text }: { text: string }) {
  const lineRef = useRef<HTMLParagraphElement>(null);
  const [revealing, setRevealing] = useState(false);
  const words = text.trim().split(/\s+/);

  useEffect(() => {
    const line = lineRef.current;
    if (!line || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia(REDUCED_MOTION).matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setRevealing(true);
      },
      { threshold: 0.6 },
    );
    observer.observe(line);
    return () => observer.disconnect();
  }, []);

  return (
    <p ref={lineRef} className={revealing ? 'landing-reveal is-revealing' : 'landing-reveal'}>
      {words.map((word, index) => (
        <Fragment key={index}>
          {index > 0 ? ' ' : null}
          <span className="landing-word" style={{ '--word-index': index } as CSSProperties}>
            {word}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
