import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useStore, useAmbience } from '../lib/store';
import { GAMES, gameById } from '../games/registry';
import { Button, Icon, Panel, SectionTitle } from '../components/ui';
import { AdSlot } from '../components/AdSlot';
import { PikachuMascot } from '../mascot';
import {
  KINDS, MAX_CONTACT, MAX_MESSAGE, MAX_NAME, MIN_MESSAGE, emptyDraft,
  localNotes, readWall, submitFeedback, validateFeedback,
  type FeedbackDraft, type FeedbackErrors, type FeedbackKind, type WallItem,
} from '../lib/feedback';

/**
 * Reviews & ideas.
 *
 * One form, four kinds, and a wall of what other people said. The form is short on
 * purpose: pick what kind of note this is, (for a review) pick a rating, write, send.
 * The name and a way to reach you are behind a disclosure, because neither is needed
 * to leave a note and a long form is the fastest way to get no notes at all.
 *
 * Everything that can go wrong is handled in the page rather than in an alert:
 * validation messages sit under their field and are announced through a polite live
 * region, a throttled device gets a sentence instead of a spinner that never ends, and
 * a note that could not reach Postgres is *still kept* and says so.
 */
export default function Feedback() {
  const { identity, cloud, toast } = useStore();
  useAmbience('hub');

  const [draft, setDraft] = useState<FeedbackDraft>(() => emptyDraft(identity.name));
  const [errors, setErrors] = useState<FeedbackErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ mode: 'cloud' | 'local' } | null>(null);
  const [wall, setWall] = useState<WallItem[] | null>(null);
  const queued = useMemo(() => localNotes().filter((n) => n.state === 'queued').length, [result]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { let alive = true; readWall(9).then((rows) => { if (alive) setWall(rows); }); return () => { alive = false; }; }, [result]);

  const kind = KINDS.find((k) => k.value === draft.kind) ?? KINDS[0];
  const set = <K extends keyof FeedbackDraft>(key: K, value: FeedbackDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const check = validateFeedback(draft);
    setErrors(check.errors);
    if (!check.ok) {
      // move focus to the first field with a problem, so a keyboard user is not stranded
      const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }
    setBusy(true);
    const out = await submitFeedback(check.clean, { playerId: identity.playerId });
    setBusy(false);
    if (!out.ok) { setErrors(out.errors); return; }
    setResult({ mode: out.mode });
    toast({
      kind: 'success',
      title: out.mode === 'cloud' ? 'Thank you — it is on the wall.' : 'Saved on this device. Thank you.',
      body: out.mode === 'cloud' ? undefined : 'It will be sent when cloud sync is on.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const again = () => {
    setDraft(emptyDraft(identity.name));
    setErrors({});
    setResult(null);
  };

  return (
    <div className="mx-auto max-w-[1100px] px-[var(--shell-pad)] py-6 sm:py-8">
      <SectionTitle
        eyebrow="The suggestion box"
        title="Reviews & ideas"
        action={<Button variant="ghost" size="sm" onClick={() => { setResult(null); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} icon={<Icon name="pen" size={14} />}>Write a note</Button>}
      />
      <p className="text-[13.5px] text-cream-300 leading-relaxed max-w-[70ch] -mt-1 mb-6">
        This arcade is one person's project, so what you think of it genuinely decides what
        gets built next. Reviews are shown on this page; game ideas and improvements are read
        and turned into work. Be honest — a lukewarm review is more useful than a polite one.
      </p>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        {/* ------------------------------------------------------------ the form */}
        <div className="min-w-0">
          {result ? (
            <Panel className="p-6 text-center a-pop">
              <div className="flex justify-center"><PikachuMascot state="victory" size={132} /></div>
              <h2 className="display text-[24px] text-cream-100 mt-1">
                {result.mode === 'cloud' ? 'Thank you — that landed.' : 'Saved. Thank you.'}
              </h2>
              <p className="text-[13px] text-cream-300 leading-relaxed mt-2 max-w-[46ch] mx-auto">
                {result.mode === 'cloud'
                  ? 'Your note is in the box and will show up on the wall if it is a review. Ideas and bug reports are read directly.'
                  : 'Cloud sync is not configured, so this note is kept safely on this device. Nothing is lost — it goes to the server the moment sync is switched on.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                <Button variant="primary" onClick={again} icon={<Icon name="pen" size={14} />}>Write another</Button>
                <Button variant="ghost" onClick={() => setResult(null)} icon={<Icon name="back" size={14} />}>Back to the box</Button>
              </div>
            </Panel>
          ) : (
            <Panel className="p-4 sm:p-6">
              <form ref={formRef} onSubmit={send} noValidate>
                {/* what kind of note */}
                <fieldset className="mb-5">
                  <legend className="eyebrow mb-2">What is this?</legend>
                  <div role="radiogroup" aria-label="Kind of note" className="grid sm:grid-cols-2 gap-2">
                    {KINDS.map((k) => {
                      const active = draft.kind === k.value;
                      return (
                        <button
                          key={k.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => set('kind', k.value as FeedbackKind)}
                          className={`text-left rounded-xl border-2 px-3 py-2.5 transition-all no-tap min-h-[56px]
                            ${active ? 'border-volt-500 bg-volt-100 shadow-[0_2px_0_0_#e0a21f]' : 'border-ink-500 bg-white/70 hover:border-ink-400 hover:bg-white'}`}
                        >
                          <span className={`block text-[13px] font-extrabold ${active ? 'text-[#5a3a12]' : 'text-cream-100'}`}>{k.label}</span>
                          <span className={`block text-[11px] ${active ? 'text-[#7a5320]' : 'text-cream-500'}`}>{k.blurb}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {/* rating, only for a review */}
                {draft.kind === 'review' && (
                  <div className="mb-5">
                    <span className="eyebrow block mb-2" id="rating-label">How many stars?</span>
                    <Stars value={draft.rating} onChange={(v) => set('rating', v)} invalid={!!errors.rating} />
                    {errors.rating && <FieldError>{errors.rating}</FieldError>}
                  </div>
                )}

                {/* the note */}
                <div className="mb-4">
                  <label htmlFor="fb-message" className="eyebrow block mb-1.5">
                    {draft.kind === 'review' ? 'Your review' : draft.kind === 'game' ? 'The game you want' : 'What happened'}
                  </label>
                  <textarea
                    id="fb-message"
                    value={draft.message}
                    onChange={(e) => set('message', e.target.value)}
                    onBlur={() => setDraft((d) => ({ ...d, message: d.message }))}
                    aria-invalid={!!errors.message}
                    aria-describedby={`fb-message-help${errors.message ? ' fb-message-err' : ''}`}
                    rows={5}
                    maxLength={MAX_MESSAGE + 200}
                    placeholder={kind.prompt}
                    className={`w-full rounded-xl border-2 bg-white/85 px-3 py-2.5 text-[13.5px] text-cream-100 leading-relaxed
                      placeholder:text-cream-400 resize-y focus:outline-none focus:ring-2 focus:ring-volt-400
                      ${errors.message ? 'border-[#d9456f]' : 'border-ink-500'}`}
                  />
                  <div className="flex items-start justify-between gap-3 mt-1.5">
                    <p id="fb-message-help" className="text-[11.5px] text-cream-500 leading-snug">
                      At least {MIN_MESSAGE} characters. No account needed, and nothing here is posted anywhere but this site.
                    </p>
                    <span className={`text-[11px] tabnum shrink-0 ${draft.message.length > MAX_MESSAGE ? 'text-blush-600 font-bold' : 'text-cream-500'}`}>
                      {draft.message.trim().length}/{MAX_MESSAGE}
                    </span>
                  </div>
                  {errors.message && <FieldError id="fb-message-err">{errors.message}</FieldError>}
                </div>

                {/* which game */}
                {draft.kind !== 'game' && (
                  <div className="mb-4">
                    <label htmlFor="fb-game" className="eyebrow block mb-1.5">Which game? <span className="normal-case font-bold text-cream-500">(optional)</span></label>
                    <select
                      id="fb-game"
                      value={draft.gameId ?? ''}
                      onChange={(e) => set('gameId', e.target.value || null)}
                      className="w-full rounded-xl border-2 border-ink-500 bg-white/85 px-3 py-2 text-[13px] text-cream-100 focus:outline-none focus:ring-2 focus:ring-volt-400"
                    >
                      <option value="">The whole arcade</option>
                      {GAMES.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                    </select>
                  </div>
                )}

                {/* name + contact, folded away */}
                <details className="mb-4 rounded-xl border-2 border-ink-500 bg-white/60 px-3 py-2">
                  <summary className="text-[12.5px] font-extrabold text-cream-300 cursor-pointer no-tap min-h-[28px] grid items-center">
                    Add a name, or a way to reach you
                  </summary>
                  <div className="grid sm:grid-cols-2 gap-3 pt-3">
                    <div>
                      <label htmlFor="fb-name" className="eyebrow block mb-1">Name on the wall</label>
                      <input id="fb-name" value={draft.name} maxLength={MAX_NAME}
                        onChange={(e) => set('name', e.target.value)}
                        placeholder="A player"
                        className="w-full rounded-lg border-2 border-ink-500 bg-white px-2.5 py-1.5 text-[13px] text-cream-100 focus:outline-none focus:ring-2 focus:ring-volt-400" />
                      {errors.name && <FieldError>{errors.name}</FieldError>}
                    </div>
                    <div>
                      <label htmlFor="fb-contact" className="eyebrow block mb-1">Email or handle</label>
                      <input id="fb-contact" value={draft.contact} maxLength={MAX_CONTACT}
                        onChange={(e) => set('contact', e.target.value)}
                        placeholder="only if you want a reply"
                        className="w-full rounded-lg border-2 border-ink-500 bg-white px-2.5 py-1.5 text-[13px] text-cream-100 focus:outline-none focus:ring-2 focus:ring-volt-400" />
                      {errors.contact && <FieldError>{errors.contact}</FieldError>}
                    </div>
                  </div>
                  <p className="text-[11px] text-cream-500 mt-2 leading-snug">
                    Your name is shown next to a published review. A contact is never shown to anyone.
                  </p>
                </details>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" variant="primary" disabled={busy} icon={<Icon name="send" size={14} />}>
                    {busy ? 'Sending…' : draft.kind === 'review' ? 'Post the review' : draft.kind === 'game' ? 'Send the idea' : 'Send it'}
                  </Button>
                  <p className="text-[11.5px] text-cream-500">
                    {cloud ? 'Goes to the arcade’s Supabase project.' : 'Cloud sync is off — this is kept on this device.'}
                  </p>
                </div>

                {/* announced politely so a screen reader hears the outcome */}
                <p role="status" aria-live="polite" className="sr-only">
                  {busy ? 'Sending your note.' : errors.message ? errors.message : ''}
                </p>
              </form>

            </Panel>
          )}

          {/* Below the form, after the thanks — never between the fields and the
              button, and nothing renders at all until ads are configured. */}
          <AdSlot placement="feedback-foot" className="mt-6" />

          {queued > 0 && (
            <p className="mt-3 text-[11.5px] text-cream-500 px-1">
              <strong className="text-cream-300">{queued}</strong> {queued === 1 ? 'note is' : 'notes are'} waiting on this device
              to reach the server. They are delivered automatically the next time cloud sync works — nothing has been lost.
            </p>
          )}
        </div>

        {/* ------------------------------------------------------------ sidebar */}
        <aside className="flex flex-col gap-4">
          <Panel className="p-4">
            <p className="eyebrow mb-1.5">What happens to this</p>
            <ul className="text-[12px] text-cream-300 space-y-1.5 leading-relaxed">
              <li>· Reviews appear on this page once posted.</li>
              <li>· Game ideas and improvements are read and triaged by hand.</li>
              <li>· Bug reports get a fix first, because a broken game is worse than a missing one.</li>
              <li>· No account, no email required, and nothing is sold or shared.</li>
            </ul>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="eyebrow">The wall</p>
              <span className="text-[10.5px] font-bold text-cream-500">{wall?.length ? `${wall.length} recent` : ''}</span>
            </div>
            {wall === null ? (
              <p className="text-[12px] text-cream-500">Looking…</p>
            ) : wall.length === 0 ? (
              <div className="text-center py-2">
                <PikachuMascot state="waiting" size={86} />
                <p className="text-[12px] text-cream-500 leading-relaxed mt-1">
                  No reviews on the wall yet. Yours would be the first one here.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {wall.slice(0, 6).map((w) => (
                  <li key={w.id} className="border-b border-ink-600 pb-2.5 last:border-0 last:pb-0">
                    <div className="flex items-center gap-1.5">
                      <Stars value={w.rating} readOnly size={13} />
                      <span className="text-[11px] font-extrabold text-cream-300 truncate">{w.display_name}</span>
                    </div>
                    <p className="text-[12px] text-cream-400 leading-relaxed mt-1 line-clamp-4">{w.message}</p>
                    {w.game_id && gameById(w.game_id) && (
                      <p className="text-[10.5px] text-cream-500 mt-1">{gameById(w.game_id)!.title}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="mt-1.5 text-[11.5px] font-bold text-blush-600 leading-snug">{children}</p>;
}

/**
 * A five-star radiogroup.
 *
 * Buttons rather than a range input so each star is a 32 px tap target on a phone,
 * and `role="radio"` with `aria-checked` so a screen reader announces "4 of 5, checked"
 * instead of "graphic". Arrow keys move and select, which is what a radiogroup is
 * supposed to do and what makes it usable without a pointer.
 */
function Stars({
  value, onChange, readOnly = false, size = 26, invalid = false,
}: {
  value: number | null; onChange?: (v: number) => void; readOnly?: boolean; size?: number; invalid?: boolean;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  if (readOnly) {
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={value ? `${value} out of 5` : 'no rating'}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} aria-hidden className={n <= (value ?? 0) ? 'text-volt-600' : 'text-cream-400'}>
            <Icon name="star" size={size} className={n <= (value ?? 0) ? 'fill-current' : ''} />
          </span>
        ))}
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby="rating-label"
      aria-invalid={invalid}
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = Math.min(5, Math.max(1, (value ?? 0) + (e.key === 'ArrowRight' ? 1 : -1)));
        onChange?.(next);
        document.getElementById(`${id}-${next}`)?.focus();
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          id={`${id}-${n}`}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          tabIndex={value === null ? (n === 1 ? 0 : -1) : value === n ? 0 : -1}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(null)}
          onClick={() => onChange?.(n)}
          className="p-1 rounded-lg no-tap focus:outline-none focus:ring-2 focus:ring-volt-400"
        >
          <Icon name="star" size={size}
            className={`transition-transform duration-100 ${n <= shown ? 'text-volt-600 fill-current scale-105' : 'text-cream-400'} ${invalid ? 'opacity-80' : ''}`} />
        </button>
      ))}
      <span className="ml-1.5 text-[12px] font-bold text-cream-500 tabnum" aria-hidden>{shown || '—'}/5</span>
    </div>
  );
}
