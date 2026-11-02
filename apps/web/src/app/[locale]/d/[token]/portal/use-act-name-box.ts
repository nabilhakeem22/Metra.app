'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface ActNameBox {
  /** The box, as typed. */
  name: string;
  setName: (typed: string) => void;
  /** The act was pressed with no name: the box is marked and says why. */
  nameMissing: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  /** No name: mark the box and move the caret there. */
  refuse: () => void;
  /** The name was refused from inside the act's dialog, which is closing: the caret goes to the box after it. */
  refuseAfterDialog: () => void;
}

/**
 * The name box of an act taken in the client's name (signing, deciding a change
 * order). The act's dialog hands focus back to the button that opened it as it
 * closes, so the caret goes to the box only after that (`dialogOpen`).
 */
export function useActNameBox(dialogOpen: boolean): ActNameBox {
  const [name, setNameValue] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [focusAfterDialog, setFocusAfterDialog] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusAfterDialog || dialogOpen) return;
    setFocusAfterDialog(false);
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [focusAfterDialog, dialogOpen]);

  return {
    name,
    setName: (typed) => {
      setNameMissing(false);
      setNameValue(typed);
    },
    nameMissing,
    nameRef,
    refuse: () => {
      setNameMissing(true);
      nameRef.current?.focus();
    },
    refuseAfterDialog: () => {
      setNameMissing(true);
      setFocusAfterDialog(true);
    },
  };
}
