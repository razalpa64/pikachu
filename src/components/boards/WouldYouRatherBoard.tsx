import type { BoardProps } from './types';
import type { WyrState, Side } from '../../games/wyr/rules';
import { chooserFor } from '../../games/wyr/rules';
import { DILEMMAS, SIDES } from '../../games/wyr/deck';
import { useStore } from '../../lib/store';
import { Icon } from '../ui';

/**
 * The online board for Would You Rather.
 *
 * Two cards, one tap each, and then a short wait — so the whole interface is the
 * dilemma, the role you have this round, and whether the other person is in yet.
 * Nothing else earns screen space here.
 *
 * The redacted state the server sends hides the opponent's side until the reveal;
 * this component renders whatever it is given and never tries to infer what it
 * has not been told.
 */
export default function WouldYouRatherBoard({ state, youSlot, onMove, interactive, names }: BoardProps<WyrState>) {
  const { sfx } = useStore();
  const chooser = chooserFor(state.index);
  const youChoose = chooser === youSlot;
  const open = state.phase === 'choose';
  const mine = state.picked[youSlot];
  const theirLocked = (state as WyrState & { lockedIn?: [boolean, boolean] }).lockedIn?.[1 - youSlot] ?? false;
  const round = state.history[state.history.length - 1];
  const revealed = state.phase === 'reveal' && !!round;
  const total = (state as WyrState & { total?: number }).total ?? state.order.length;

  const pick = (side: Side) => {
    if (!interactive || !open || mine) return;
    sfx('click');
    onMove({ type: 'pick', side });
  };

  return (
    <div className="w-full max-w-[760px] mx-auto flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="eyebrow">{youChoose ? 'You pick — they are guessing' : `${names[1 - youSlot]} picks — you are guessing`}</p>
        <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-cream-400">
          Round {Math.min(state.index + 1, total)} / {total}
        </span>
      </div>

      <div className="panel panel-notch p-4 sm:p-5">
        <h2 className="display text-[19px] sm:text-[23px] text-cream-100 mb-3.5">Would you rather…</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          {(['a', 'b'] as const).map((side) => {
            const s = SIDES[side];
            const minePicked = mine === side;
            const flagged = minePicked;
            return (
              <button
                key={side}
                data-side={side}
                onClick={() => pick(side)}
                disabled={!interactive || !open || !!mine}
                aria-pressed={minePicked}
                className="relative text-left p-4 min-h-[108px] notch-sm border-2 transition-all no-tap disabled:cursor-default hover:-translate-y-0.5 hover:shadow-[0_4px_0_0_var(--line-strong)]"
                style={{
                  background: s.tint,
                  borderColor: s.border,
                  boxShadow: flagged ? '0 4px 0 0 var(--line-strong)' : undefined,
                }}
              >
                <span className="inline-grid place-items-center w-6 h-6 rounded-full border-2 text-[11px] font-extrabold mb-2"
                  style={{ borderColor: s.border, color: s.ink, background: '#fffdf7' }}>{s.letter}</span>
                <span className="block display text-[16px] sm:text-[18px] leading-snug" style={{ color: s.ink }}>
                  {round && !open ? (side === 'a' ? round.dilemma.a : round.dilemma.b) : (side === 'a' ? currentDilemma(state).a : currentDilemma(state).b)}
                </span>
                {(revealed && round) && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {round.choice === side && (
                      <span className="px-2 py-[2px] rounded-full bg-[#fffdf7] border text-[9px] font-extrabold uppercase tracking-wider"
                        style={{ borderColor: s.border, color: s.ink }}>{round.chooser === youSlot ? 'Your answer' : `${names[1 - youSlot]}'s answer`}</span>
                    )}
                    {round.guess === side && (
                      <span className="px-2 py-[2px] rounded-full bg-[#fffdf7] border text-[9px] font-extrabold uppercase tracking-wider"
                        style={{ borderColor: s.border, color: s.ink }}>{round.chooser === youSlot ? 'Their guess' : 'Your guess'}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-[12px]" aria-live="polite">
          {open && !mine && theirLocked && <p className="text-cream-500">They are in. Your call — the answer stays hidden until you pick.</p>}
          {open && !mine && !theirLocked && <p className="text-cream-500">{youChoose ? 'Pick the one you would actually choose.' : 'Which one do you think they picked?'}</p>}
          {open && mine && !theirLocked && <p className="text-cream-500 flex items-center gap-1.5"><Icon name="clock" size={13} />Locked in. Waiting for the other side…</p>}
          {open && mine && theirLocked && <p className="text-cream-500">Both in. Revealing…</p>}
          {revealed && round && (
            <p className="font-extrabold" style={{ color: round.points === youSlot ? 'var(--color-leaf-700)' : 'var(--color-blush-600)' }}>
              {round.points === youSlot ? 'Point to you' : round.points === null ? 'No point this round' : `Point to ${names[1 - youSlot]}`}
              {' · '}{round.hit ? 'they read it right' : 'a surprise'}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 text-[11.5px] font-extrabold uppercase tracking-wider">
        <span className="text-cream-500">You <span className="text-leaf-700 tabnum">{state.score[youSlot]}</span></span>
        <span className="text-cream-400">·</span>
        <span className="text-cream-500">{names[1 - youSlot]} <span className="text-blush-600 tabnum">{state.score[1 - youSlot]}</span></span>
      </div>
    </div>
  );
}

/** The dilemma for the round that is currently open. The server trims `order` to
 *  the rounds already reached, and the deck lives in the shared module, so the
 *  client can look the text up without being handed the whole script. */
function currentDilemma(state: WyrState) {
  const id = state.order[Math.min(state.index, state.order.length - 1)];
  return DILEMMAS.find((d) => d.id === id) ?? DILEMMAS[0];
}
