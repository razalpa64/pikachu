# Pikachu Arcade — where it actually stands

A report on the retrofit, written to be checked rather than admired. Every number
below is produced by a file in this repository or by a command named beside it;
nothing here is an estimate dressed up as a statistic.

Last updated with the free-software DOS shelf: eight licensed games beside the calibration cartridge.

## The two shelves

| | GBA | DOS |
|---|---|---|
| Games a visitor can play | **22** (committed homebrew) | **9** (8 licensed games + the CC0 calibration cartridge) |
| Where the files live | `public/retro/roms/` (95 MB, in the repo) | `public/retro/dos/bundles/` (15.3 MB, in the repo) + storage for uploads |
| Emulator | EmulatorJS 4.2.3 (MIT), mGBA core, lazy | js-dos 8.5.3 (GPL-2.0), DOSBox core, lazy |
| Document | `/retro/player.html` | `/retro/dos.html` |
| Page | `/retro/:id` | `/retro/dos/:id` |
| Licence evidence | per-cartridge, in `roms.json` and `NOTICE.txt` | per-title, in `site_content` key `dos.perm.<id>` |

Both players speak the same `pikachu-retro` postMessage contract, so the chrome
around them — pause, mute, fullscreen, error copy — behaves the same way in both.

## The discovery pipeline, in numbers

`npm run dos:import` reads the file tree of `YAL-PJ/dos-freeware-games-library`
and writes `public/retro/dos/catalog.json`. It downloads no game. The record of
that run:

| Stage | Count | Meaning |
|---|---|---|
| discovered | **1 499** | titles the source repository lists |
| metadata-only | **13** | listed, but the source has no bundle for them |
| pending-rights-review | **1 486** | a bundle exists at the source; **nobody has recorded a right to host it** |
| permission-approved | **0** | no evidence has been recorded for any title |
| downloaded with authorisation | **0** | no bundle was fetched, because nobody is authorised yet |
| ready-for-testing | **0** | — |
| playable | **0** | — |

Source labels, quoted rather than interpreted: **759 “Freeware”, 740 “Shareware”**.
Neither is a redistribution grant, which is why the pipeline stops at
`pending-rights-review` and why the importer can never promote a record on its
own. Five bundles were inspected structurally as a sample (`npm run
dos:import -- --inspect 5`); all five were valid ZIPs with a `.jsdos/dosbox.conf`.
That is a statement about the *format*, not about the right to host them.

## A bug that made every DOS game look broken

The first version of `public/retro/dos.html` pinned js-dos at
`pathPrefix: "/retro/jsdos/"`. js-dos does not append `emulators/` to that value —
it appends the file names, so it asked for `/retro/jsdos/emulators.js`, which has
never existed in this repository. The 404 is silent inside js-dos: it logs to the
console, keeps its own loading screen and never creates a `<canvas>`. The player's
own watchdog then reported, 25 seconds later, "DOS started, but no screen
appeared" — blaming the bundle for the site's own 404. The shelf's smoke test had
been *asserting the broken value*, so it passed.

Fixed: the prefix is one constant, `/retro/jsdos/emulators/`, the player now
fetches `emulators.js`, `wdosbox.js` and `wdosbox.wasm` through that constant
before booting and names any missing file instead of blaming the game, and three
places pin it — a unit test that resolves the prefix against `public/`, the smoke
test that fetches it over HTTP, and `VENDOR.md`. Bundles also no longer end their
`[autoexec]` with `exit`: quitting DOS shuts js-dos down, which reads as a crash.

## The nine committed DOS cartridges

Nothing in this table came from a ROM site, a "freeware" aggregator or a
third-party upload. Each game was published by the person who wrote it, in their
own repository, under the licence shown; `npm run dos:games` downloads the files
at the pinned commit, packages them and checks the result, and
`scripts/dos/records.json` records the commit and the bundle's SHA-256.

| Cartridge | Licence | Source (pinned commit) | Bundle |
|---|---|---|---|
| Celis | GPL-3.0 | `GadZombie/celis` @ `01bea78` | 1 181 383 B |
| Sadist | GPL-3.0 | `GadZombie/sadist` @ `2372676` | 8 088 373 B |
| Out of Cash | GPL-3.0 | `warrior-rockk/out-of-cash` @ `8dd5c62` | 4 229 809 B |
| Super Vinnie-Pooh | Apache-2.0 | `D0NM/Vinnie` @ `b84f07b` | 2 499 398 B |
| Floppybird | MIT | `icebreaker/floppybird` @ `511ffa5` | 11 259 B |
| Moth Hunter | MIT | `w84death/x86-assembly` @ `83a8662` | 3 075 B |
| nasm-tetris | MIT | `Arkowski24/nasm-tetris` @ `3fc9598` | 6 348 B |
| Snake (54 bytes) | MIT | `donno2048/snake` @ `45b2117` | 2 515 B |
| Calibration | CC0-1.0 | authored here, `scripts/dos/make-shelf.ts` | 879 B |

16 023 039 bytes of cartridges in total, all committed, all re-derivable with
`npm run dos:games`.

Two packaging rules are worth writing down, because both were got wrong first:

- **js-dos mounts the bundle as `C:\`.** A bundle is a ZIP whose `.jsdos/` folder
  holds the config and whose every other entry lands in the DOS root, so the
  program named by `[autoexec]` has to sit at the archive root. The calibration
  binary was originally placed in `GAME/`, which the autoexec could never have
  found; it is at the root now, and `make-shelf.ts`, `make-games.ts` and
  `smoke-dos.ts` all assert that the autoexec line resolves to a real entry.
- **A build we cannot reproduce is not packaged.** Nothing here is compiled:
  there is no DOS toolchain in this repository. Where the project publishes its
  own `.jsdos` (Out of Cash does), that file is shipped byte for byte; elsewhere
  the author's published binaries and data are copied unmodified and only the
  `dosbox.conf` and a `SOURCE.TXT` note are added. Each bundle carries its
  licence text as `LICENSE.TXT`.

```
celis.jsdos          1 181 383 B   CELIS.EXE · CELIS.DAT · CELIS.CFG · DZWIEK.CFG · CELIS.TXT · USTAW.EXE
sadist.jsdos         8 088 373 B   SADIST.EXE · GRAF.DAT · SADIST.DAT · 2 × .CFG · POSTACI/ · TERENY/ · WAV/BMP assets
out-of-cash.jsdos    4 229 809 B   the project's own bundle, unmodified (OUTCASH.EXE + CWSDPMI + *DATA.DAT banks)
moth-hunter.jsdos        3 075 B   MOTH.COM (508 B) + LICENSE.TXT + SOURCE.TXT
pikachu-calibration.jsdos  879 B   CALIB.COM (179 B) + README.TXT
```

Sadist's data is lifted out of `Data/` and flattened next to the executable
because its Pascal source opens `graf.dat`, `sadist.dat`, the two `.CFG` files,
`brzeg1.bmp`, `obiekt<N>.bmp`, `textur<N>.bmp` and its WAV banks as bare names in
the current directory — the same layout its installer produces. Its `Data/Install/`
folder, editor tools and the duplicate `.DAT` copies are left out.

## DOS titles that were refused, and why

- **Doom (id Software, 1993)** — the engine source is GPL, the WADs are not, and
  the game is still sold. There is no free build to host, so the shelf links
  nothing and the discovery index keeps its record for *Doom* at
  `pending-rights-review`, exactly like the other 1 485 unresolved titles.
- **Grand Theft Auto: Vice City (Rockstar, 2002)** — a commercial Windows title
  with no MS-DOS release. It cannot be a DOS cartridge at all.
- **dos.zone / the big browser-DOS arcades** — not mirrored, and not plumbed in.
  Two reasons, and only the first is technical: the host is unreachable from this
  build environment, and more importantly a catalogue of ten thousand DOS titles
  is not a licence to any of them. Most of those libraries are commercial games,
  "abandonware" or shareware of unknown provenance; copying them into this repo
  would break the one rule the shelf has. Titles that pass the licence test can
  be added one at a time, from their authors' own repositories, which is how the
  eight above got here.
- Other free-software candidates were checked and dropped for concrete reasons
  rather than convenience:
  - `mausimus/dos2025` — the committed `BIN/QUIDPROQ.RVD` starts with `RVD1`,
    not an `MZ` header: it is not a DOS executable, so it cannot be packaged.
  - `GadZombie/sadist2` — the repository holds the engine, core data and the
    English `SADIST2.EXE`, but the `postaci/`, `tereny/`, `tekstury/` and `tla/`
    content folders its own code opens are not committed (its README points at
    gadz.pl for a working copy), so a bundle built from it would boot and die.
  - `warrior-rockk/timmy-time-adventure` — a real GPL-3.0 DOS platformer, but
    `web/` contains only the DOSBox config and a title image; the game archive is
    a release asset, and release assets cannot be fetched here.
  - `antonijn/dos-game-suite-8086`, `tstamborski/wild-snake-boa-ii`,
    `dzutrinh/2048` — same release-asset problem, so nothing could be verified
    and nothing was claimed.
  - `rep-stosw/tube-game-dos` (and `tube64`), `OpenCrystalCaves`,
    `xms0g/breakout` — either a reverse-engineering of a commercial game, an
    engine that needs the original commercial data, or source with no committed
    executable.

## What is verified, and by what

| Claim | Proof | Ran here? |
|---|---|---|
| The shelf pages render and never show a pending title | `src/screens/__tests__/retro-dos.test.ts` (jsdom, real components) | **yes** |
| A `.jsdos` bundle is a ZIP with `dosbox.conf`, no traversal, no bomb | `src/lib/__tests__/dos.test.ts` | **yes** |
| A “Freeware”/“Shareware” label is never treated as permission | same file, `judgeRedistribution` | **yes** |
| A DOS row cannot carry a GBA path (and vice versa) | `src/lib/__tests__/supabase-schema.test.ts` + PGlite | **yes** |
| The player document, the 1.4 MB core, the bundle and both manifests are served correctly | `npm run smoke:dos` | **yes, green** |
| Every bundle's `[autoexec]` starts a program that is really at the archive root | `npm run smoke:dos` (now checks the entry, not just the conf) | **yes, green** |
| The player asks js-dos for its cores at a path that exists, over HTTP | `src/lib/__tests__/dos.test.ts` + `npm run smoke:dos` | **yes, green** |
| js-dos draws a frame and the calibration bars are in it | `npm run e2e:retro:dos` (Playwright) | **no — no Chromium in this sandbox** |
| Any of the eight games actually plays | would need a browser and a DOS runtime | **no — and there is no DOSBox in this sandbox to test with either** |

`npm test` → 819 tests in 54 files. `tsc -b` clean. `npm run lint` → 0 errors.

The one claim this report will not make is “the DOS shelf plays”. The HTTP and
structural layers are proven; the framebuffer is not. On a machine with a browser,
`npm run e2e:retro:dos` is the check that turns that claim honest — it asserts on
canvas pixels, on pause holding the picture still, and on fullscreen taking the
viewport.

## What the admin desk can do

`/admin` → **DOS desk**:

- **Discovery queue** — search and filter 1 499 records by title, genre, year and
  decision. Approve or refuse writes a dated evidence string to `site_content`
  (`dos.perm.<id>`, ≤60 characters of key, ≤1 200 of value) and an audit row
  (`dos.approved` / `dos.blocked`). Approval records a right; it publishes
  nothing.
- **Upload** a `.jsdos` bundle — checked in the browser (ZIP, config present, no
  path escape, no size bomb), validated again by the shelf’s own validator before
  a byte is sent, stored as `<id>/game.jsdos` with a generated cover, inserted as
  `platform = 'dos'`, audited as `dos.upload`.
- **Manage** — publish, unpublish, delete, and test the player, drafts included.
  A draft preview is reachable only by an account the database calls an admin,
  because `listAllGames` is gated by row-level security.

`/admin` → **GBA shelf** is unchanged from phase 5 and still lists only
`platform = 'gba'` rows.

## Security and copyright posture

- Every publishing decision is server-refereed: RLS on `retro_games` and
  `site_content`, `is_admin()`, storage writes admin-only.
- Metadata and archives are treated as untrusted: allowlisted URLs only
  (`.jsdos` over https, or a path inside `/retro/dos/`), no absolute paths, no
  `..`, no `javascript:`, no protocol-relative sources, entry counts and claimed
  sizes bounded, bundle capped at 48 MB.
- Freeware/shareware labels are recorded and labelled as labels.
- Nothing was copied from a commercial ROM site; the RetroBrews collection was
  used for discovery only and nothing from it is mirrored.
- Unpublishing and deleting are buttons, and both drop the storage objects.

## Gaps, stated plainly

1. **No browser test of the DOS player in this environment.** See the table above.
2. **Migration `0006_dos.sql` has been rehearsed in PGlite only.** It has not been
   applied to a live Supabase project; the deploy order is `0001` → `0006`.
3. **Phase 5’s commit (`89e7958`) is not on `main`.** This branch was cut from
   `fcb1142`, so the migration runner and `admin:doctor --apply` that phase 5
   added are not part of this tree.
4. **No visitor-facing “add your own DOS game”.** A `.jsdos` bundle is a whole
   installation and cannot be verified the way a 156-byte cartridge header can,
   so DOS uploads stay behind the admin desk. The GBA “drop your own cartridge”
   path is unchanged.
5. **Recently-played and favourites are not on the retro shelf.** They exist for
   the arcade’s own games; wiring them to the retro library is not done, and this
   report would rather say so than have a row of empty carousels.
6. **The DOS discovery job is a maintainer script, not a scheduled job.** There is
   no GitHub Action yet; the admin desk says so and shows the last run’s source
   commit and date.
