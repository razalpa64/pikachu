/**
 * The DOS on-screen pad.
 *
 * A DOS game reads the keyboard directly, so a phone has no way to play one —
 * `point`/`touch` do nothing for a program that polls INT 16h. The pad closes
 * that gap: every button here posts a `key` command to the player document,
 * which dispatches a real `KeyboardEvent` at the js-dos canvas. (That path is
 * proven end-to-end by `scripts/e2e/retro-dos.mjs`: it presses *only* this pad
 * and checks that the calibration cartridge left its "press a key" banner and
 * painted its colour bars.)
 *
 * Three rules shaped it:
 *
 *  1. **It never covers the picture.** It sits below the screen inside the
 *     monitor, in normal flow, so it can never sit on top of a HUD element in
 *     the game — and it stays put in fullscreen, which is where a phone player
 *     actually needs it.
 *  2. **Hold means hold.** A platformer wants "run left for a second", not four
 *     taps. Holding an arrow repeats `keydown` the way a real keyboard does,
 *     and releasing sends the `keyup` that stops the character.
 *  3. **Nothing invented.** These are the keys the games on this shelf actually
 *     wait for — arrows, Space, Enter, Esc, Ctrl, Tab, and the digits that pick
 *     a menu entry. No mapping layer, no remapping UI.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface DosKey {
  /** the `key` value of the KeyboardEvent */
  key: string;
  /** the physical `code`, when the game wants the position rather than the label */
  code: string;
  /** the legacy `keyCode` DOSBox matches on */
  keyCode: number;
  /** what the player reads on the button */
  label: string;
  /** what a screen reader reads — the label alone is too terse */
  aria: string;
  /** keep repeating while the finger stays down (movement keys) */
  repeat?: boolean;
}

export const DOS_DPAD: DosKey[] = [
  { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, label: '▲', aria: 'Up arrow', repeat: true },
  { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, label: '◀', aria: 'Left arrow', repeat: true },
  { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, label: '▼', aria: 'Down arrow', repeat: true },
  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, label: '▶', aria: 'Right arrow', repeat: true },
];

export const DOS_ACTIONS: DosKey[] = [
  { key: ' ', code: 'Space', keyCode: 32, label: 'Space', aria: 'Space — jump, fire or continue' },
  { key: 'Enter', code: 'Enter', keyCode: 13, label: 'Enter', aria: 'Enter — confirm' },
  { key: 'Escape', code: 'Escape', keyCode: 27, label: 'Esc', aria: 'Escape — menu or quit' },
  { key: 'Control', code: 'ControlLeft', keyCode: 17, label: 'Ctrl', aria: 'Control — fire in most shooters' },
  { key: 'Tab', code: 'Tab', keyCode: 9, label: 'Tab', aria: 'Tab — next field or menu' },
  { key: 'Shift', code: 'ShiftLeft', keyCode: 16, label: 'Shift', aria: 'Shift — run in most platformers' },
];

/** The whole pad, in the order it is laid out, for the table-driven test. */
export const DOS_PAD_KEYS = [...DOS_DPAD, ...DOS_ACTIONS];

/**
 * How long a held key waits before repeating.
 *
 * DOSBox samples the key state; 110 ms is fast enough that a held arrow reads as
 * continuous movement in the games on this shelf, and slow enough that a short
 * tap never turns into two moves.
 */
export const DOS_REPEAT_MS = 110;

export interface KeySender {
  (spec: DosKey, action: 'down' | 'up' | 'tap'): void;
}

function KeyButton({
  spec,
  onSend,
  className = '',
  children,
}: {
  spec: DosKey;
  onSend: KeySender;
  className?: string;
  children?: React.ReactNode;
}) {
  const timer = useRef(0);
  const held = useRef(false);

  const stop = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    window.clearInterval(timer.current);
    timer.current = 0;
    onSend(spec, 'up');
  }, [onSend, spec]);

  /* A component unmounted mid-press must not leave the key down in the
     emulator — that reads as a character running into a wall for ever. */
  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    if (held.current) onSend(spec, 'up');
  }, [onSend, spec]);

  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (held.current) return;
    held.current = true;
    /* Keep the press on this button even if the finger slides a little: losing
       the pointer mid-run is how a jump gets stuck down. */
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    onSend(spec, 'down');
    if (spec.repeat) {
      timer.current = window.setInterval(() => onSend(spec, 'down'), DOS_REPEAT_MS);
    }
  };

  return (
    <button
      type="button"
      className={`dos-pad-key ${className}`}
      aria-label={spec.aria}
      data-key={spec.key}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children ?? spec.label}
    </button>
  );
}

export default function DosPad({ onKey, disabled }: { onKey: KeySender; disabled?: boolean }) {
  const send = useCallback<KeySender>((spec, action) => {
    if (disabled) return;
    onKey(spec, action);
  }, [disabled, onKey]);

  const dpad = (key: string) => DOS_DPAD.find((k) => k.key === key)!;

  return (
    <div className="dos-pad" role="group" aria-label="On-screen game controls">
      <div className="dos-pad-stick">
        <KeyButton spec={dpad('ArrowUp')} onSend={send} className="dos-pad-up" />
        <KeyButton spec={dpad('ArrowLeft')} onSend={send} className="dos-pad-left" />
        <span className="dos-pad-hub" aria-hidden />
        <KeyButton spec={dpad('ArrowRight')} onSend={send} className="dos-pad-right" />
        <KeyButton spec={dpad('ArrowDown')} onSend={send} className="dos-pad-down" />
      </div>

      <div className="dos-pad-actions">
        {DOS_ACTIONS.map((spec) => (
          <KeyButton key={spec.key} spec={spec} onSend={send} />
        ))}
      </div>
    </div>
  );
}
