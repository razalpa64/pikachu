import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as jukebox from '../lib/jukebox';
import { Button, Icon, Panel, SectionTitle, Stat, Toggle, ConfirmDialog, EmptyState } from '../components/ui';
import { PikachuMascot, PikaScene } from '../mascot';
import { useStore } from '../lib/store';

/**
 * Our Music — the shared record player.
 *
 * Tracks live in IndexedDB on this device (see `lib/jukebox.ts`), never on a
 * server: these are the couple's own files and uploading them somewhere would
 * be both a licensing problem and a privacy one. That is stated plainly in the
 * UI rather than left for someone to discover.
 */
export default function Music() {
  const { sfx, settings, setSettings } = useStore();
  const [st, setSt] = useState<jukebox.JukeboxState>(jukebox.getState());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => jukebox.subscribe(setSt), []);
  useEffect(() => { void jukebox.refreshLibrary(); }, []);

  const current = useMemo(() => st.tracks.find((t) => t.id === st.currentId) ?? null, [st.tracks, st.currentId]);
  const totalBytes = useMemo(() => st.tracks.reduce((n, t) => n + t.size, 0), [st.tracks]);

  const take = useCallback(async (files: FileList | File[] | null) => {
    if (!files || !('length' in files) || files.length === 0) return;
    setBusy(true); setNote(null);
    try {
      const res = await jukebox.addFiles(files);
      await jukebox.refreshLibrary();
      const bits: string[] = [];
      if (res.added.length) bits.push(`${res.added.length} track${res.added.length === 1 ? '' : 's'} added`);
      if (res.rejected?.length) bits.push(`${res.rejected.length} skipped`);
      setNote(bits.join(' · ') || 'Nothing to add');
      if (res.added.length) sfx('achievement');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read those files');
    } finally {
      setBusy(false);
    }
  }, [sfx]);

  const pct = st.duration > 0 ? Math.min(1, st.position / st.duration) : 0;

  return (
    <div
      className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-7"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer?.files ?? null); }}
    >
      <header className="mb-6 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow text-blush-600 mb-1.5">Just for the two of you</p>
          <h1 className="display text-[30px] sm:text-[38px] text-cream-100">Our Music</h1>
          <p className="text-[13.5px] text-cream-500 mt-1.5 max-w-[60ch]">
            Add your own songs and they play behind every game. They stay on this device — nothing is
            uploaded anywhere.
          </p>
        </div>
        <PikaScene clip="meadow" className="hidden lg:block w-[230px] shrink-0" rounded={18} tilt={-1.5} />
      </header>

      {/* ---------------------------------------------------------- player */}
      <Panel className="p-0 overflow-hidden mb-5">
        <div className="relative">
          {/* warm band behind the record player */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: 'linear-gradient(118deg,#ffe9b8 0%,#ffd1de 46%,#ffe6d0 100%)', opacity: 0.85 }}
          />
          <div className="relative flex flex-col sm:flex-row items-center gap-5 p-5 sm:p-6">
            {/* the mascot is the album art, and it reacts to what the player is doing */}
            <div className="shrink-0 grid place-items-center w-[132px] h-[132px] rounded-full border-[3px] border-ink-400 bg-ink-800/80 overflow-hidden">
              <PikachuMascot
                state={st.playing ? 'excited' : current ? 'waiting' : 'sleeping'}
                size={st.playing ? 124 : 112}
              />
            </div>

            <div className="flex-1 min-w-0 w-full text-center sm:text-left">
              <p className="eyebrow text-[#7a4a22]">{st.playing ? 'Now playing' : current ? 'Paused' : 'Nothing playing'}</p>
              <p className="display text-[19px] sm:text-[23px] text-cream-100 truncate mt-0.5" title={current?.name}>
                {current ? current.name.replace(/\.[a-z0-9]+$/i, '') : 'Pick a song below'}
              </p>

              {/* scrubber — real position, draggable */}
              <div className="mt-3 flex items-center gap-2.5">
                <span className="tabnum text-[11px] font-bold text-[#7a4a22] w-[38px] text-right">{jukebox.clock(st.position)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(st.duration))}
                  value={Math.floor(st.position)}
                  onChange={(e) => jukebox.seek(Number(e.target.value))}
                  disabled={!current || st.duration <= 0}
                  aria-label="Seek through the track"
                  className="flex-1 h-2 accent-[#e05a74] cursor-pointer disabled:cursor-default"
                  style={{ background: `linear-gradient(90deg,#f2779a ${pct * 100}%, rgba(255,255,255,.6) ${pct * 100}%)`, borderRadius: 999 }}
                />
                <span className="tabnum text-[11px] font-bold text-[#7a4a22] w-[38px]">{jukebox.clock(st.duration)}</span>
              </div>

              <div className="mt-3.5 flex items-center gap-2 justify-center sm:justify-start flex-wrap">
                <Button size="sm" variant="ghost" onClick={() => void jukebox.prev()} disabled={!st.tracks.length}
                  aria-label="Previous track" icon={<Icon name="chevron-left" size={15} />}>Prev</Button>
                <Button
                  size="lg"
                  onClick={() => { sfx('select'); void jukebox.toggle(); }}
                  disabled={!st.tracks.length}
                  aria-label={st.playing ? 'Pause' : 'Play'}
                  icon={<Icon name={st.playing ? 'pause' : 'play'} size={17} />}
                >
                  {st.playing ? 'Pause' : 'Play'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void jukebox.next()} disabled={!st.tracks.length}
                  aria-label="Next track" icon={<Icon name="chevron-right" size={15} />}>Next</Button>
                <span className="w-2" />
                <Toggle
                  checked={settings.shuffle}
                  onChange={(v) => { setSettings({ shuffle: v }); jukebox.setShuffle(v); }}
                  label="Shuffle"
                />
              </div>
            </div>
          </div>
        </div>

        {st.error && (
          <p role="alert" className="px-5 py-2.5 text-[12.5px] font-semibold text-[#8d2740] bg-[#ffe0e6] border-t-2 border-[#e05a74]">
            {st.error}
          </p>
        )}
      </Panel>

      {/* ---------------------------------------------------------- library */}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] items-start">
        <div>
          <SectionTitle eyebrow={`${st.tracks.length} track${st.tracks.length === 1 ? '' : 's'}`} title="Your songs" />
          <Panel className="p-2 mt-3">
            {st.tracks.length === 0 ? (
              <EmptyState
                title="No songs yet"
                body="Add a few favourites and they'll play while you're in a match."
                action={<Button size="sm" onClick={() => fileRef.current?.click()} icon={<Icon name="plus" size={14} />}>Add music</Button>}
              />
            ) : (
              <ul className="divide-y divide-ink-600">
                {st.tracks.map((t) => {
                  const on = t.id === st.currentId;
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-2.5 py-2">
                      <button
                        onClick={() => { sfx('select'); void jukebox.playTrack(t.id); }}
                        aria-label={`Play ${t.name}`}
                        className={`shrink-0 w-9 h-9 grid place-items-center rounded-full border-2 transition-colors ${
                          on && st.playing ? 'bg-volt-400 border-ink-400 text-[#5a3a12]' : 'bg-ink-800 border-ink-500 text-cream-300 hover:border-ink-400'
                        }`}
                      >
                        <Icon name={on && st.playing ? 'pause' : 'play'} size={14} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13.5px] font-bold truncate ${on ? 'text-volt-700' : 'text-cream-100'}`}>
                          {t.name.replace(/\.[a-z0-9]+$/i, '')}
                        </p>
                        <p className="text-[11px] text-cream-500">{jukebox.humanSize(t.size)}</p>
                      </div>
                      <button
                        onClick={async () => { await jukebox.removeTrack(t.id); await jukebox.refreshLibrary(); }}
                        aria-label={`Remove ${t.name}`}
                        className="shrink-0 p-2 min-h-[34px] text-cream-500 hover:text-[#e05a74]"
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div>
          <SectionTitle eyebrow="Add to the shelf" title="Upload" />
          <Panel className={`mt-3 p-5 border-2 border-dashed transition-colors ${dragging ? 'border-blush-400 bg-blush-100/50' : 'border-ink-500'}`}>
            <div className="flex items-center gap-3 mb-3">
              <PikachuMascot state={busy ? 'loading' : 'idle'} size={76} />
              <p className="text-[12.5px] text-cream-500 leading-relaxed">
                Drop files here, or choose them. MP3, M4A, OGG, WAV and FLAC all work.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={jukebox.ACCEPT}
              multiple
              className="sr-only"
              onChange={(e) => { void take(e.target.files); e.target.value = ''; }}
            />
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}
                icon={<Icon name="plus" size={14} />}>{busy ? 'Adding…' : 'Choose files'}</Button>
              {st.tracks.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} icon={<Icon name="x" size={13} />}>
                  Remove all
                </Button>
              )}
            </div>
            {note && <p className="text-[12px] font-semibold text-cream-300 mt-3">{note}</p>}

            <div className="flex gap-2.5 mt-4 flex-wrap">
              <Stat label="Tracks" value={st.tracks.length} />
              <Stat label="Space used" value={jukebox.humanSize(totalBytes)} />
            </div>
            <p className="text-[11.5px] text-cream-500 mt-3 leading-relaxed">
              Stored in this browser on this device, up to about 40&nbsp;MB. Clearing site data removes them.
            </p>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Remove every song?"
        body="This clears the whole shelf from this device. The original files on your computer are untouched."
        confirmLabel="Remove all"
        danger
        onConfirm={async () => { setConfirmClear(false); await jukebox.clearAll(); await jukebox.refreshLibrary(); setNote('Shelf cleared'); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
