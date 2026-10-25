import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { extractCode, isPartialCode } from '../lib/roomCode';
import { Button, Icon } from './ui';

/**
 * The five-letter code, typed straight where you are.
 *
 * Before this, the only way into a friend's room from the front page was
 * Home → Play Together → Join tab → paste → submit: three screens to type five
 * characters, on a page whose whole promise is "share a code and play".
 *
 * It accepts what people actually have to hand: `QK4TA`, `qk4ta`, or a whole
 * invite link pasted from a chat (`https://…/room/QK4TA`), which is what the
 * copy button on the room screen puts on the clipboard. It deliberately does not
 * try to dig a code out of a sentence: guessing there would accept "THERE" out of
 * "hello there", and the room screen reports a wrong code far better than a
 * disabled button does.
 */
export function JoinCode({ autoFocus = false, className = '' }: { autoFocus?: boolean; className?: string }) {
  const nav = useNavigate();
  const { sfx } = useStore();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = extractCode(value);
    // red only when the visitor is done typing something unusable — never mid-keystroke
    if (!code) { setError(true); sfx('error'); return; }
    sfx('select');
    nav(`/together?code=${code}`);
  };

  return (
    <form onSubmit={submit} className={`flex flex-col gap-1.5 ${className}`} noValidate>
      <div className="flex gap-2">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Room code</span>
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(false); }}
            onBlur={() => { if (value.trim() && !isPartialCode(value) && !extractCode(value)) setError(true); }}
            onFocus={() => sfx('hover')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- this is an explicit jump-to-action
            autoFocus={autoFocus}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            placeholder="Room code — e.g. QK4TA"
            aria-invalid={error || undefined}
            aria-describedby={error ? 'join-code-error' : undefined}
            className={`w-full bg-ink-800 border-2 pl-9 pr-3 h-11 text-[13.5px] font-mono tracking-[.18em] uppercase text-cream-100 placeholder:font-sans placeholder:tracking-normal placeholder:normal-case placeholder:text-cream-400 notch-sm outline-none transition-colors
              ${error ? 'border-[#bd2756]' : 'border-ink-500 focus:border-volt-500'}`}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-500"><Icon name="link" size={15} /></span>
        </label>
        <Button type="submit" variant="primary" className="shrink-0 h-11">Join</Button>
      </div>
      {error && (
        <p id="join-code-error" role="alert" className="text-[11.5px] font-bold text-[#a83350]">
          A room code is five letters or numbers — or paste the invite link.
        </p>
      )}
    </form>
  );
}

export default JoinCode;
