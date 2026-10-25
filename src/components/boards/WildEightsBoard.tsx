import type { BoardProps } from './types';
import { CardFace, CardBack } from '../../games/cards/CardFace';
import {
  canPlay, playable, topCard, sortHand, handValue, cardName, rankLabel, suitOf,
  SUITS, SUIT_SYMBOL, SUIT_RED, humanise, type EightsState,
} from '../../games/cards/rules';

/**
 * Online Wild Eights.
 *
 * Presentational only: it renders whatever the server sent and reports clicks
 * upward. The state it receives is redacted, so the opponent's hand and the
 * stock arrive as -1 placeholders — count them, never try to read them.
 */
export default function WildEightsBoard({ state, youSlot, onMove, interactive, names }: BoardProps<EightsState>) {
  const them = (youSlot === 0 ? 1 : 0) as 0 | 1;
  const myHand = sortHand(state.hands[youSlot].filter((c) => c >= 0));
  const theirCount = state.hands[them].length;
  const top = topCard(state);
  const myTurn = interactive && state.turn === youSlot && !state.over;

  const mine = playable(state, youSlot);
  const stuck = myTurn && !state.awaitingSuit && state.pendingDraw === 0 && mine.length === 0;
  const outOfDraws = stuck && state.drawnThisTurn >= state.config.drawLimit;
  const canDraw = stuck && !outOfDraws && state.stock.length + state.discard.length > 1;
  const suitChanged = state.suit !== suitOf(top);

  return (
    <div className="w-full max-w-[860px] mx-auto">
      {/* opponent */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="eyebrow">{names[them]}</span>
        <div className="flex shrink-0" aria-label={`${names[them]} holds ${theirCount} cards`}>
          {Array.from({ length: Math.min(theirCount, 12) }, (_, i) => (
            <div key={i} style={{ marginLeft: i ? -26 : 0 }}><CardBack small /></div>
          ))}
        </div>
        <span className="text-[12px] font-bold text-cream-500">{theirCount} cards</span>
        {state.turn === them && !state.over && (
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-blush-600">their turn</span>
        )}
      </div>

      {/* table */}
      <div className="panel panel-notch p-5">
        <div className="flex items-center justify-center gap-7 sm:gap-12 flex-wrap">
          <div className="text-center">
            <p className="eyebrow mb-1.5">Stock</p>
            <button
              onClick={() => onMove({ type: 'draw' })}
              disabled={!canDraw}
              aria-label="Draw a card from the stock"
              className="disabled:opacity-55 disabled:cursor-default enabled:hover:-translate-y-1 transition-transform"
            >
              <CardBack count={state.stock.length} />
            </button>
            {canDraw && (
              <p className="mt-1 text-[10.5px] font-bold text-cream-500">
                {state.config.drawLimit - state.drawnThisTurn} draws left
              </p>
            )}
          </div>

          <div className="text-center">
            <p className="eyebrow mb-1.5">In play</p>
            <CardFace card={top} label={`Top card: ${cardName(top)}`} />
            {suitChanged && (
              <p className="mt-1.5 text-[11px] font-extrabold uppercase tracking-wide">
                <span className="text-cream-500">called </span>
                <span className={SUIT_RED[state.suit] ? 'text-ember-600' : 'text-cream-100'}>
                  {SUIT_SYMBOL[state.suit]} {state.suit}
                </span>
              </p>
            )}
          </div>

          {state.pendingDraw > 0 && (
            <div className="text-center">
              <p className="eyebrow mb-1.5">Penalty</p>
              <div className="w-[64px] h-[92px] grid place-items-center rounded-[10px] border-[2.5px] border-[#e05a74] bg-[#ffe0e6]">
                <span className="font-display text-[26px] font-extrabold text-[#b63553]">+{state.pendingDraw}</span>
              </div>
            </div>
          )}
        </div>

        {/* suit chooser — only ever shown to the player who owes the choice */}
        {state.awaitingSuit && myTurn && (
          <div className="mt-5 pt-4 border-t-2 border-dashed border-ink-500">
            <p className="eyebrow mb-2">Call a suit</p>
            <div className="flex gap-2 flex-wrap">
              {SUITS.map((s) => (
                <button
                  key={s}
                  onClick={() => onMove({ type: 'suit', suit: s })}
                  aria-label={`Call ${s}`}
                  className={`px-4 py-2.5 border-2 border-ink-400 notch-sm bg-ink-800 hover:bg-volt-200 font-extrabold text-[15px] transition-colors ${
                    SUIT_RED[s] ? 'text-ember-600' : 'text-cream-100'
                  }`}
                >
                  <span className="text-[20px] mr-1.5">{SUIT_SYMBOL[s]}</span>{s}
                </button>
              ))}
            </div>
          </div>
        )}

        {state.awaitingSuit && !myTurn && (
          <p className="mt-4 pt-3 border-t-2 border-dashed border-ink-500 text-center text-[12.5px] text-cream-300">
            {names[state.turn]} played an eight and is choosing a suit.
          </p>
        )}

        {/* recovery actions, shown only while they are legal */}
        {myTurn && !state.awaitingSuit && (state.pendingDraw > 0 || outOfDraws) && (
          <div className="mt-5 pt-4 border-t-2 border-dashed border-ink-500 flex gap-2 flex-wrap justify-center">
            {state.pendingDraw > 0 && (
              <button
                onClick={() => onMove({ type: 'take' })}
                className="px-4 py-2 border-2 border-ink-400 notch-sm bg-ink-800 hover:bg-blush-200 font-extrabold text-[13px] text-cream-100"
              >
                Pick up {state.pendingDraw}
              </button>
            )}
            {outOfDraws && state.pendingDraw === 0 && (
              <button
                onClick={() => onMove({ type: 'pass' })}
                className="px-4 py-2 border-2 border-ink-400 notch-sm bg-ink-800 hover:bg-blush-200 font-extrabold text-[13px] text-cream-100"
              >
                Pass the turn
              </button>
            )}
          </div>
        )}
      </div>

      {/* your hand */}
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="eyebrow">Your hand</span>
          <span className="text-[11px] font-bold text-cream-500">{myHand.length} cards · {handValue(myHand)} pts</span>
          {myTurn && !state.awaitingSuit && mine.length > 0 && (
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-leaf-700">{mine.length} playable</span>
          )}
          {!myTurn && !state.over && (
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-cream-500">waiting</span>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Your hand">
          {myHand.map((card) => {
            const ok = myTurn && canPlay(state, card);
            return (
              <CardFace
                key={card}
                card={card}
                onClick={ok ? () => onMove({ type: 'play', card }) : undefined}
                disabled={!ok}
                dim={myTurn && !ok}
                label={`${cardName(card)}${ok ? '' : ' — not playable'}`}
              />
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-center text-[12px] text-cream-500">
        {state.over
          ? humanise(state.reason, names)
          : myTurn
            ? state.awaitingSuit ? 'Call a suit.' : `Follow ${state.suit} or match the ${rankLabel(top)}.`
            : `Waiting for ${names[state.turn]}.`}
      </p>
    </div>
  );
}
