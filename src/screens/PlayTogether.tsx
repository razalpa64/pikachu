import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { onlineGames } from '../games/registry';
import type { GameMeta } from '../games/types';
import { GameArtwork } from '../components/GameArtwork';
import { Button, Icon, Panel, SectionTitle, Segmented } from '../components/ui';
import { PikachuMascot, PikaScene, BoltRule } from '../mascot';
import { useRoom } from '../lib/useRoom';
import { useStore, useAmbience } from '../lib/store';

export default function PlayTogether() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { room, create, join, conn, connect, error, clearError, presence, queue, findMatch, cancelMatch } = useRoom();
  const { identity, setIdentity, sfx, award } = useStore();
  useAmbience('hub');

  const games = onlineGames();
  /* Other screens deep-link here: `?game=chess` from a game's title bar, `?join=1`
     from the home panel, `?code=ABCDE` from an invite. All three used to be ignored
     except `join`, so "Play online" silently opened whichever game happened to be
     first in the list. */
  const wanted = params.get('game');
  const initial = games.find((g) => g.id === wanted) ?? games[0];
  const [tab, setTab] = useState<'create' | 'join'>(params.get('join') || params.get('code') ? 'join' : 'create');
  const [picked, setPicked] = useState<GameMeta>(initial);
  const [settings, setSettings] = useState<Record<string, unknown>>(() => defaultsFor(initial));
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [name, setName] = useState(identity.name);
  const [pending, setPending] = useState<'create' | 'join' | null>(null);
  /* A clock that only runs while we are actually waiting for somebody. */
  const [now, setNow] = useState(() => Date.now());
  const searching = queue !== null;
  useEffect(() => {
    if (!searching) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [searching]);
  const waited = searching && queue ? Math.max(0, Math.floor((now - queue.at) / 1000)) : 0;
  /* The relay only mentions games with activity, so "absent" means "nobody",
     not "unknown" — once presence has arrived, zero is the honest number. */
  const counts = useMemo(
    () => (presence ? (presence.games[picked.id] ?? { playing: 0, waiting: 0 }) : null),
    [presence, picked.id],
  );
  const crowd = useMemo(() => {
    if (!counts) return 'Connecting to the relay…';
    if (counts.playing + counts.waiting === 0) return `Nobody in ${picked.title} right now — you would be next in line`;
    return `${counts.playing} playing · ${counts.waiting} looking for a game`;
  }, [counts, picked.title]);

  useEffect(() => { connect(); }, [connect]);
  useEffect(() => { if (room) nav(`/room/${room.code}`, { replace: true }); }, [room, nav]);
  useEffect(() => { if (error) setPending(null); }, [error]);
  useEffect(() => { setSettings(defaultsFor(picked)); }, [picked]);

  const commitName = () => {
    const trimmed = name.trim().slice(0, 20);
    if (trimmed && trimmed !== identity.name) setIdentity({ name: trimmed });
  };

  const doCreate = () => {
    commitName();
    clearError(); setPending('create'); sfx('select');
    award('arena-opener');
    create(picked.id, settings, roomName.trim() || `${identity.name || 'Trainer'}’s Arena`,
      settings.coop === true ? 'coop' : 'online');
  };
  const doJoin = () => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (clean.length !== 5) return;
    commitName();
    clearError(); setPending('join'); sfx('select');
    join(clean);
  };

  return (
    <div className="mx-auto max-w-[1180px] px-[var(--shell-pad)] py-7">
      <header className="mb-6 flex items-end justify-between gap-5 flex-wrap">
        <div>
          <p className="eyebrow text-blush-600 mb-1.5">Two of us, one little room</p>
          <h1 className="display text-[30px] sm:text-[38px] text-cream-100">Play Together</h1>
          <p className="text-[13.5px] text-cream-500 mt-1.5 max-w-[58ch]">
            Find a random opponent with one button, or open a private room and send the five-letter code. Either way the
            server referees every move from there.
          </p>
        </div>
        <PikaScene clip="crowd" className="hidden sm:block w-[280px] shrink-0" rounded={26} tilt={-1.5} />
      </header>

      <div className="flex gap-1 mb-5">
        {(['create', 'join'] as const).map((t) => (
          <button key={t} onClick={() => { sfx('toggle'); setTab(t); clearError(); }} aria-pressed={tab === t}
            className={`px-5 py-2.5 rounded-full text-[12.5px] font-extrabold uppercase tracking-wider border-2 transition-colors no-tap
              ${tab === t ? 'bg-volt-300 text-[#5a3a12] border-ink-500' : 'bg-white text-cream-500 border-ink-500 hover:bg-blush-100 hover:text-cream-100'}`}>
            {t === 'create' ? 'Create a room' : 'Join with a code'}
          </button>
        ))}
      </div>

      {/* identity strip */}
      <Panel className="p-3.5 mb-5 flex flex-wrap items-center gap-3">
        <span className="eyebrow">Your trainer name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} maxLength={20}
          placeholder="Trainer" aria-label="Trainer name"
          className="bg-white border-2 border-ink-500 rounded-full px-4 py-2 text-[13.5px] text-cream-100 placeholder:text-cream-400 focus:border-blush-300 outline-none w-[200px]" />
        <span className="text-[11.5px] text-cream-500">Shown to your opponent in the lobby.</span>
      </Panel>

      {error && (
        <Panel className="p-3.5 mb-5 border-ember-400/60 flex items-start gap-3" role="alert">
          <PikachuMascot state="error" size={64} />
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-extrabold text-ember-600">{error.message}</p>
            {error.recovery && <p className="text-[12px] text-cream-500 mt-0.5">{error.recovery}</p>}
          </div>
          <Button size="sm" variant="ghost" onClick={clearError}>Dismiss</Button>
        </Panel>
      )}

      {tab === 'create' ? (
        <div>
          {/* ------------------------------------------------ quick match */}
          <Panel
            className={`p-4 mb-5 ${searching ? 'border-volt-400' : ''}`}
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {/* On a phone the mascot would take a third of the width and squeeze
                the sentence into a tall column; the words carry the panel. */}
            <PikachuMascot state={searching ? 'waiting' : 'idle'} size={88} className="hidden sm:block shrink-0 self-start" />
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="eyebrow text-blush-600">Quick match</p>
                <span className="text-[11px] font-bold uppercase tracking-wider text-cream-500">
                  {picked.title}
                </span>
              </div>
              <p className="display text-[19px] text-cream-100 leading-tight mt-0.5">
                {searching ? 'Looking for someone…' : 'Play a stranger, right now'}
              </p>
              <p className="text-[12.5px] text-cream-500 mt-1 max-w-[62ch] leading-relaxed">
                {searching
                  ? 'The relay will pair you with the next trainer who asks for the same game and start the countdown itself. Keep this tab open.'
                  : 'One button, no code: the relay pairs you with the next person who asks for this game, opens the room, and referees it exactly like a private one.'}
              </p>
              <p className="text-[11.5px] text-cream-500 mt-1.5">
                {crowd}
                {presence ? ` · ${presence.players} trainer${presence.players === 1 ? '' : 's'} in the arcade` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {searching ? (
                <>
                  <span className="font-mono text-[13px] text-volt-700 tabular-nums" aria-label="Time spent searching">
                    {String(Math.floor(waited / 60))}:{String(waited % 60).padStart(2, '0')}
                  </span>
                  <Button variant="ghost" className="flex-1 sm:flex-none justify-center" onClick={() => { sfx('toggle'); cancelMatch(); }}>
                    Stop looking
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  className="w-full sm:w-auto justify-center"
                  onClick={() => {
                    commitName();
                    clearError();
                    sfx('select');
                    findMatch(picked.id, settings, `${identity.name || 'Trainer'}’s quick match`);
                  }}
                  disabled={conn === 'offline'}
                  icon={<Icon name="spark" size={15} />}
                >
                  Find an opponent
                </Button>
              )}
            </div>
            </div>
            {searching && waited >= 30 && (
              <p className="w-full text-[12px] text-cream-400 mt-3">
                Nobody has turned up yet. You can keep waiting — the queue is served in order, so you will be first
                when someone arrives — or stop and open a private room.
              </p>
            )}
          </Panel>

        <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
          <div>
            <SectionTitle eyebrow="Step 1" title="Pick the game" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {games.map((g) => {
                const active = picked.id === g.id;
                return (
                  <button key={g.id} onClick={() => { sfx('click'); setPicked(g); }} aria-pressed={active}
                    className={`relative h-[130px] panel notch-sm overflow-hidden text-left no-tap transition-all
                      ${active ? 'border-volt-400 -translate-y-0.5' : 'hover:border-ink-400'}`}>
                    <GameArtwork artKey={g.artKey} className={active ? 'opacity-85' : 'opacity-50'} />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/55 to-transparent" />
                    <div className="relative h-full p-3 flex flex-col justify-end">
                      <p className="display text-[15px] text-cream-100">{g.title}</p>
                      <p className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: g.accent }}>{g.tagline}</p>
                    </div>
                    {active && <span className="absolute top-2 right-2 w-6 h-6 bg-volt-400 text-[#5a3a12] grid place-items-center"><Icon name="check" size={14} /></span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:sticky lg:top-[72px]">
            <SectionTitle eyebrow="Step 2" title="Room settings" />
            <Panel className="p-4 flex flex-col gap-4">
              <div>
                <label htmlFor="roomname" className="eyebrow block mb-1.5">Room name</label>
                <input id="roomname" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={34}
                  placeholder={`${identity.name || 'Trainer'}’s Arena`}
                  className="w-full bg-ink-800 border border-ink-500 px-3 py-2 text-[13.5px] text-cream-100 placeholder:text-cream-400 notch-sm focus:border-volt-500 outline-none" />
              </div>

              {(picked.settings ?? []).map((s) => (
                <div key={s.key}>
                  <p className="eyebrow mb-1.5">{s.label}</p>
                  {s.type === 'toggle' ? (
                    <Segmented value={settings[s.key] === true ? 'on' : 'off'} size="sm" label={s.label}
                      onChange={(v) => setSettings((p) => ({ ...p, [s.key]: v === 'on' }))}
                      options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />
                  ) : (
                    <div className="relative">
                      <select value={String(settings[s.key])} aria-label={s.label}
                        onChange={(e) => {
                          const opt = s.options?.find((o) => String(o.value) === e.target.value);
                          setSettings((p) => ({ ...p, [s.key]: opt ? opt.value : e.target.value }));
                        }}
                        className="peer w-full appearance-none bg-ink-800 border border-ink-500 pl-3 pr-9 py-2 text-[13px]
                          font-semibold tracking-wide text-cream-100 notch-sm focus:border-volt-500 outline-none cursor-pointer
                          hover:border-ink-400 transition-colors">
                        {s.options?.map((o) => (
                          <option key={String(o.value)} value={String(o.value)} className="bg-ink-800 text-cream-100">{o.label}</option>
                        ))}
                      </select>
                      <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-volt-700 peer-focus:text-volt-700">
                        <Icon name="chevron-down" size={14} />
                      </span>
                    </div>
                  )}
                </div>
              ))}

              <div className="pt-1 border-t border-ink-600">
                <p className="text-[11.5px] text-cream-500 leading-relaxed mb-3">
                  Rooms expire after 90 minutes of silence. Both players get a 45-second reconnect window if the
                  connection drops mid-match.
                </p>
                <Button variant="primary" className="w-full" onClick={doCreate} disabled={pending === 'create'}
                  icon={<Icon name="plus" size={15} />}>
                  {pending === 'create' ? 'Opening arena…' : 'Create private room'}
                </Button>
              </div>
            </Panel>
          </div>
        </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_1fr] gap-5 items-start">
          <Panel className="p-6">
            <SectionTitle eyebrow="Enter the arena" title="Room code" />
            <p className="text-[13px] text-cream-500 mb-4 leading-relaxed">
              Five letters and numbers, exactly as your rival sent them. An invite link works too — it fills this in for you.
            </p>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              onKeyDown={(e) => { if (e.key === 'Enter') doJoin(); }}
              placeholder="ABCDE" aria-label="Room code" autoComplete="off" spellCheck={false}
              className="w-full bg-ink-800 border-2 border-ink-500 px-4 py-4 font-mono text-[34px] sm:text-[42px] tracking-[.34em] text-center text-volt-700 placeholder:text-cream-500 notch-sm focus:border-volt-400 outline-none uppercase" />
            <Button variant="primary" size="lg" className="w-full mt-4" onClick={doJoin}
              disabled={code.length !== 5 || pending === 'join'} icon={<Icon name="link" size={16} />}>
              {pending === 'join' ? 'Knocking…' : 'Join room'}
            </Button>
            <p className="text-[11.5px] text-cream-500 mt-3 text-center">
              Rejoining a match you were already in? Use the same code — your slot is held for you.
            </p>
          </Panel>

          <Panel className="p-6 flex flex-col items-center text-center gap-3">
            <PikachuMascot state="waiting" size={160} />
            <h3 className="display text-[19px] text-cream-100">No code yet?</h3>
            <p className="text-[13px] text-cream-500 max-w-[36ch] leading-relaxed">
              Switch to <strong className="text-cream-100">Create a room</strong>, choose a game, and share the code
              that appears. Whoever opens the room is the host and starts the match.
            </p>
            <div className="flex gap-2 flex-wrap justify-center">
              <Button variant="ghost" onClick={() => setTab('create')} icon={<Icon name="plus" size={15} />}>Create one instead</Button>
              <Button variant="ghost" onClick={() => { setTab('create'); sfx('click'); }} icon={<Icon name="spark" size={15} />}>
                Play a stranger
              </Button>
            </div>
          </Panel>
        </div>
      )}

      <BoltRule className="mt-10" />
    </div>
  );
}

function defaultsFor(g: GameMeta | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of g?.settings ?? []) out[s.key] = s.default;
  if (g?.id === 'memory') {
    const [c, r] = String(out.size ?? '4x4').split('x').map(Number);
    out.cols = c; out.rows = r;
  }
  return out;
}
