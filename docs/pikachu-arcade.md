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

Fixed: the prefix is one constant, `/retro/jsdos/emulators/`, and the player now
fetches `emulators.js`, `wdosbox.js` and `wdosbox.wasm` through that constant
before booting, naming any missing file instead of blaming the game. The check
looks at the *body*, not the status, because this dev server answers a missing
path with `index.html` and a `200` — the silent success that hid the original
bug (`/retro/jsdos/emulators.js` → `200 · text/html`).

Four things pin it now: a unit test resolving the prefix against `public/` on
disk, a smoke check fetching the three files over HTTP and asserting their
content types, a smoke check that the old prefix does *not* serve the loader, and
`VENDOR.md`, which explains the concatenation to whoever changes the player next.
Bundles also no longer end their `[autoexec]` with `exit`: quitting DOS shuts
js-dos down, which reads as a crash.

### The second bug: js-dos was waiting for a click nobody was told about

With the prefix fixed, the shelf still reported "DOS started, but no screen
appeared" on every game. The bundle was not at fault either time.

js-dos renders its `<canvas>` in exactly one place — the run window — and it
enters that window when the bundle signals `bndReady` *and* `autoStart` is true
with `countDownStart` at zero. `autoStart` defaults to false and the player
never set it, so js-dos did exactly what it is designed to do: it loaded the
bundle, showed its own pre-run screen with a Play button, and stopped. No
canvas, no error, no console message. Our watcher polled for a canvas that could
never appear and blamed the archive for it 25 seconds later.

The fix is one option and one honest signal:

- `autoStart: true`, `countDownStart: 0` — the machine starts by itself, which is
  the only behaviour this desk has ever promised.
- `kiosk: true`, `theme: "dark"` — js-dos's own sidebar and start screen are
  gone, so the bezel holds the game and nothing else.
- `onEvent` handling `ci-ready` — js-dos's real readiness signal, preferred over
  polling; a canvas is still watched for as the fallback, because the library
  can reach "running" by more than one route.
- If a pre-run screen does appear anyway (an older checkout, a future upgrade),
  the player *presses its Play button itself* rather than leaving a visitor
  staring at chrome they were never told about.
- The watchdog is 45 s, not 25 s — a cold boot fetches a 1.4 MB core and unpacks
  up to 8 MB inside WebAssembly — and when it fires it quotes whatever js-dos has
  written on its screen, then says the fault is in the player. It never says
  "the bundle is broken" unless something actually checked the bundle.

`src/screens/__tests__/dos-player.test.ts` runs the shipped document in jsdom
with a scripted `window.Dos`: it asserts the options we pass, that `ci-ready`
turns the boot card off, that a canvas is noticed without an event, that a
pre-run screen gets clicked, and that js-dos's error text is repeated verbatim.
Removing `autoStart` from the player fails that suite — verified by doing it.
`src/lib/__tests__/dos.test.ts` additionally checks the *vendored library* still
contains the `autoStart`/`countDownStart` gate, the `ci-ready` event and the
`.pre-run-window` class, so an upgrade that renames them fails the build instead
of the shelf.

The desk page around it was fixed in the same pass: a state card inside the
bezel (warming up / still working / stopped), the player's own reason printed
under the monitor, a **Try again** that remounts the player document, **Open
alone** for the standalone player, and keyboard focus handed to the frame once
it boots so the first arrow key already moves the game.

### The third bug, found by playing them: a mouse capture card over every game

Once the machine started, every cartridge booted — and seven of the nine put a
full-screen **“Click to capture mouse”** card and a sensitivity slider over the
game before it could be played. That is not a fault in js-dos: it reads
`autolock` out of each `dosbox.conf`, turns it into pointer lock, and shows the
capture UI while the lock is pending. DOSBox's own default is `autolock=true`,
authors copy their conf from a template, and the packaging script copied theirs
— so the setting arrived switched on.

None of the nine cartridges is a mouse-look first-person game. The two
adventures (Celis, Sadist) move the DOS cursor absolutely, which needs no lock;
the rest are keyboard games. Every `dosbox.conf` this repository generates now
sets `autolock=false` (`scripts/dos/make-games.ts`), and
`src/lib/__tests__/dos.test.ts` fails the build if `autolock=true` reappears in a
shipped bundle.

The same pass found a smaller one in our own test card. `CALIB.COM` ended with
`INT 21h AH=4Ch` — a clean exit to DOS — so DOSBox cleared mode 13h and left a
bare `C:\>` prompt. The cartridge whose entire job is to prove the player works
finished on a black screen. It now loops: banner, key, colour bars, key, banner
again, until the visitor leaves. `dos.test.ts` asserts the `4C 00` exit sequence
is absent.

### What the nine games actually do, now that there is a browser

Verified in headless Chromium (1280×860, WebGL through SwiftShader) by loading
each cartridge, waiting for the canvas, pressing the keys a player would press,
and comparing the frames before and after:

| Cartridge | Boots | What was on the screen | Accepted input |
|---|---|---|---|
| Calibration | yes | banner → four colour bars → back to the banner | **yes**, Space alternates both screens |
| Floppybird | yes | title screen, then the game: parrot, city skyline, score | **yes**, Space starts it and flaps |
| Moth Hunter | yes | the playfield: ship row at the top, moth below | **yes**, arrows move, Space fires |
| nasm-tetris | yes | board, falling piece, next-piece box, score | **yes**, arrows move/rotate the piece |
| Snake (54 bytes) | yes | the playfield, snake body, food | **yes**, arrows steer it |
| Super Vinnie-Pooh | yes | Russian title menu, (c) 1996 FaMe, then attract mode | **yes**, Enter advances it |
| Celis | yes | author credit screen, starfield, music player | **yes**, the animation advances |
| Sadist | yes | the studio logo / title card | **not confirmed** — Enter and Space left the frame unchanged |
| Out of Cash | yes | DOSBox banner, `OUTCA$H.EXE` loader, then the WARCOM SOFT 2025 logo | **partly** — it advanced through its loader; menu input not confirmed |

That is nine of nine booting and drawing, six confirmed to take keyboard input,
one whose title screen ignores the keys tried, and one still loading. It is not
a claim that anybody finished a game — it is a claim that the player and the
archive work, made from pixels rather than from hope.

Getting there needed a browser this sandbox could not download. The repository's
own `npm run e2e:retro:dos` now runs against any Chromium build via
`PIKACHU_CHROME` / `PIKACHU_LD`, and **it passes, on desktop and on a phone
viewport** — 22 checks each, including the colour bars in the framebuffer, a
keypress leaving the banner, and pause holding the picture still.

### A pad, because a DOS program reads the keyboard

A phone has no arrow keys, and a DOS game does not care about taps: it polls the
keyboard through the emulated BIOS. The player therefore grew a pad, under the
picture and inside the same element that goes fullscreen:

* **What it sends.** `{type:'cmd', cmd:'key'}` to `/retro/dos.html` with the key,
  its `code` and the legacy `keyCode` DOSBox matches on. The player document
  dispatches a real `KeyboardEvent` on the js-dos canvas — the same path a
  physical key takes.
* **What it offers.** Arrow cross, Space, Enter, Esc, Ctrl, Shift, Tab. Holding an
  arrow repeats `keydown` every 110 ms so a character keeps walking; letting go
  sends `keyup`. Action keys never repeat (a repeating Enter opens and closes a
  menu).
* **Where it is.** Below the canvas, never over it, and it appears unasked on a
  coarse pointer, a touch screen or a window under 820 px. The bezel also gained
  a labelled way back to the shelf, because this page hides the site navigation
  and "Stop" sounds like it throws the game away.

It is proven the only way that counts: `npm run e2e:retro:dos -- --phone` presses
**nothing but the pad** and checks that the calibration cartridge leaves its
"press a key" banner and paints its colour bars. Nine jsdom tests
(`src/components/__tests__/dos-pad.test.ts`) cover the messages, the repeat and
the release-on-unmount.

What the pad cannot do is type. A text adventure still needs a keyboard, and a
game that drives a mouse still wants a mouse; the page says so instead of
implying otherwise. Two things had to be
fixed in that script to make it honest: reading the canvas with
`drawImage` returns black because js-dos renders through WebGL (it now decodes a
real screenshot, PNG and all), and the colour-bar check scanned a *horizontal*
line through vertically-stacked bars, so it could only ever see one colour.

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
| The player passes the options that make js-dos start at all | `src/screens/__tests__/dos-player.test.ts` (jsdom, scripted `window.Dos`) | **yes** |
| js-dos's `ci-ready`, a canvas and a stray pre-run screen all end in "running" | same file | **yes** |
| An error from js-dos is repeated to the visitor, with a working retry | `src/screens/__tests__/retro-dos.test.ts` | **yes** |
| The vendored js-dos still honours `autoStart` / `ci-ready` / `.pre-run-window` | `src/lib/__tests__/dos.test.ts` | **yes** |
| js-dos draws a frame, the calibration bars are in it, a keypress reaches the program, pause holds the picture | `npm run e2e:retro:dos` (Playwright, headless Chromium) | **yes — 22 checks, desktop and phone** |
| The on-screen pad alone can drive a DOS program: below the picture, 40 px+ targets, on screen, alive in fullscreen | the same harness with `--phone` (it presses no physical key at all) | **yes** |
| The pad sends down/up, repeats a held arrow, releases on cancel and on unmount, and stays silent before the machine runs | `src/components/__tests__/dos-pad.test.ts` | **yes** |
| All nine cartridges boot and draw | the same harness, one cartridge at a time, frames compared before and after input | **yes** |
| Six of them visibly respond to the keys a player presses | same | **yes** |
| Sadist and Out of Cash take menu input beyond their first screens | would need a longer scripted run per game | **no** |

`npm test` → 884 tests in 58 files. `tsc -b` clean. `npm run lint` → 0 errors.

What this report still will not claim is that all nine games are *finishable*, or
that a human sat and played them end to end. What it can now claim, because the
pixels were read, is that every cartridge boots into its own screen, that six of
them visibly respond to the keys a player presses, and that the player's own
controls — pause, resume, mute, fullscreen, the error card — behave. The honest
gap left is Sadist's menu and Out of Cash's menu, which a five-second scripted
press did not get past.

Reproducing it needs only a browser. `npm run e2e:retro:dos` (add `--phone` for
the touch viewport) runs against the dev server; if the sandbox cannot download
Chromium, point `PIKACHU_CHROME` and `PIKACHU_LD` at any Chromium build and the
same checks run. That is how the DOS shelf went from "structurally correct" to
"watched working" in one sitting.

## The phone is a shell, not a page

The desktop layout has a 58 px header, seven links and a right-hand rail. On a
390 px screen none of that fits, and shrinking it was the wrong answer: a header
with seven small links is a website telling you it is a website. Below `lg` the
site is an app instead.

- **Five tabs, thumb height.** `nav[aria-label="Quick"]` — Home, Games,
  Together, Solo, Retro — fixed to the bottom, 78×58 px per tab, padded for the
  home indicator. Above `lg` it does not exist (`height: 0`).
- **A title bar that names the screen.** 63 px, sticky, safe-area padded, and it
  carries the account button instead of a hamburger drawer. The drawer is gone.
- **Games own their bar.** On `/solo/*` and `/room/*` the site header hides
  (`ownBar` in `AppShell.tsx`) and the screen's own bar is sticky at `top: 0`.
  Two title bars on a phone spent 63 px saying the same thing twice; removing it
  moved the chess board from 341 px down to 183 px.
- **Overlays are sheets.** `Sheet` portals to `document.body` — inline it would
  inherit the screen's stacking context and slide under the tab bar — and every
  confirmation, the account menu, the join-code pad and the library's Filter
  games sheet come up from the bottom with the scrim, focus trap, Escape, focus
  return and body scroll lock that a native sheet has. Above `lg` they remain
  centred dialogs.
- **Content first.** The hero painting is 124 px on a phone (300–380 px above
  `sm`) because it is a horizon, not content; Home's section rhythm is 6 rather
  than 10; Library's rail and manifesto paragraph are hidden, and its controls
  fit one row with the filter list behind a sheet.
- **No zoom on focus.** Every text field is 16 px at `max-width: 1023px`; iOS
  zooms the whole page for anything smaller and never zooms back.
- **Nothing toasts under the bar.** The toast stack sits at
  `calc(74px + env(safe-area-inset-bottom))` on a phone, so a saved profile
  never covers the navigation.
- **The viewport is honest.** `viewport-fit=cover` plus
  `interactive-widget=resizes-content`, and `theme-color`/manifest match the
  paper the header is painted on, so an installed copy has a dark-on-cream status
  bar rather than white on cream.

The contract is checked, not asserted: `npm run e2e:shell` drives a 390×844
touch viewport through nine routes and makes 56 assertions — no route scrolls
sideways (`scrollWidth === 390`), tab geometry, the title bar's name, the account
sheet's position and its Escape/focus/scroll-lock behaviour, the filter sheet
narrowing 26 games to 17, the game screen's own bar sticking at 0 with the board
at 183 px, and a confirm sheet at 572 px with 47 px buttons. It runs against the
dev server like the other harnesses.

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

1. **The browser test needs a Chromium, and this sandbox cannot download one.**
   `npx playwright install chromium` is blocked here, so the run recorded above
   used an external Chromium build via `PIKACHU_CHROME` / `PIKACHU_LD`. On a
   normal machine the plain command works. Either way, the check exists and
   passes — what is missing is only the download.
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
