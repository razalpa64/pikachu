/**
 * Card faces, shared by the solo view and the online board so there is exactly
 * one implementation of what a card looks like.
 *
 * A face-down card from the server arrives as -1 (see `redact` in rules.ts);
 * `CardBack` is what you render for those.
 */
import { SUIT_SYMBOL, SUIT_RED, cardName, isWild, rankLabel, suitOf } from './rules';

export function CardFace({
  card, onClick, disabled, dim, small, label,
}: {
  card: number; onClick?: () => void; disabled?: boolean; dim?: boolean; small?: boolean; label?: string;
}) {
  const suit = suitOf(card);
  const red = SUIT_RED[suit];
  const rank = rankLabel(card);
  const wild = isWild(card);
  const w = small ? 'w-[52px] h-[74px]' : 'w-[64px] h-[92px]';
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      {...(onClick ? { onClick, disabled, type: 'button' as const } : {})}
      aria-label={label ?? cardName(card)}
      className={`relative shrink-0 ${w} rounded-[10px] border-[2.5px] border-ink-400 bg-[#fffaf0]
        flex flex-col justify-between p-1.5 select-none transition-transform
        ${onClick && !disabled ? 'hover:-translate-y-2 focus-visible:-translate-y-2 cursor-pointer' : ''}
        ${disabled ? 'cursor-default' : ''} ${dim ? 'opacity-45 saturate-50' : ''}`}
      style={{ boxShadow: '0 3px 0 rgba(140,94,70,.35), inset 0 2px 0 rgba(255,255,255,.8)' }}
    >
      <span className={`relative z-10 font-display text-[15px] font-extrabold leading-none ${red ? 'text-ember-600' : 'text-cream-100'}`}>
        {rank}<span className="block text-[10px] leading-none">{SUIT_SYMBOL[suit]}</span>
      </span>
      <span
        className={`absolute inset-0 grid place-items-center ${small ? 'text-[30px]' : 'text-[40px]'} leading-none ${red ? 'text-[#e0567a]' : 'text-[#8a6a58]'}`}
        aria-hidden
      >
        {SUIT_SYMBOL[suit]}
      </span>
      <span className={`relative z-10 self-end font-display text-[15px] font-extrabold leading-none rotate-180 ${red ? 'text-ember-600' : 'text-cream-100'}`}>
        {rank}<span className="block text-[10px] leading-none">{SUIT_SYMBOL[suit]}</span>
      </span>
      {wild && (
        <span
          className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-volt-400 border-2 border-ink-400 text-[9px] font-extrabold text-[#5a3a12]"
          aria-hidden
        >★</span>
      )}
    </Tag>
  );
}

export function CardBack({ small, count }: { small?: boolean; count?: number }) {
  const w = small ? 'w-[52px] h-[74px]' : 'w-[64px] h-[92px]';
  return (
    <div
      className={`relative ${w} rounded-[10px] border-[2.5px] border-ink-400 overflow-hidden`}
      style={{
        background: 'repeating-linear-gradient(45deg,#ffd95a 0 7px,#ffcf3d 7px 14px)',
        boxShadow: '0 3px 0 rgba(140,94,70,.35)',
      }}
      aria-hidden
    >
      <div className="absolute inset-1.5 rounded-[6px] border-2 border-ink-400/35" />
      {count !== undefined && (
        <span className="absolute inset-0 grid place-items-center font-display text-[17px] font-extrabold text-[#5a3a12]">
          {count}
        </span>
      )}
    </div>
  );
}
