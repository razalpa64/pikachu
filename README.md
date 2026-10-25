# PIKACHU — a little arcade built for two

A private, art-directed arcade made as a gift. Twenty-six complete games, a real chess engine, genuine
AI opponents, and private online rooms refereed by a server that never trusts the browser.

No template, no purchased UI kit, no stock dashboard. The cream-paper look, the painted game
covers, the boards, the icons and the sound are all made for this project.

---

## Run it

```bash
npm install
npm run dev:all      # Vite on :5173 + the authoritative relay on :8787
```

Open <http://localhost:5173>. That is everything — no accounts, no keys, no cloud.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server only (solo games work; online rooms need the relay) |
| `npm run relay` | The authoritative WebSocket referee on `:8787` |
| `npm run dev:all` | Both, side by side |
| `npm run build` | Type-check the whole project, then build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | 225 unit tests across rules, AI, engines, audio and progression |
| `npm run coverage` | The same with a V8 coverage report |
| `npm run smoke` | End-to-end relay test: two headless clients play a full match (relay must be running) |
| `npm run e2e` | Browser tests: every route, four solo games, and a real two-browser online match |
| `npm run lint` | oxlint over `src` and `server` |
| `npm run typecheck` | `tsc -b` — note: run the local binary, never `npx tsc` |

Vite proxies `/rt` (WebSocket) and `/api` to the relay, so the browser only ever talks to its own
origin — nothing in the client points at `localhost`, which is what makes a hosted preview work.

### Environment

Copy `.env.example` to `.env` if you want cloud sync or to point at a deployed relay:

```bash
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_REALTIME_TRANSPORT=relay
VITE_RELAY_URL=                # e.g. wss://your-relay.onrender.com/rt (for Vercel deployment)
RELAY_PORT=8787
```

Motion, sound and interaction rules are written down in [`docs/motion.md`](docs/motion.md) — four durations, one scene animation per screen, and the reduced-motion contract every new animation has to live inside.

See [`supabase/README.md`](supabase/README.md) for the schema, RLS policies and migration.
When the two `VITE_SUPABASE_*` vars are absent the SDK is never downloaded at all — the import is
dynamic and gated, so the default setup ships ~200 kB less JavaScript.

#### Advertising (off unless you switch it on)

The build contains **no ad SDK and no publisher id**. Three slots exist — `home-foot`,
`library-foot`, `feedback-foot`, all below real content and none inside a game — and each renders
literally nothing until both halves of the switch are flipped:

1. `VITE_ADSENSE_CLIENT` holds a real `ca-pub-` id (plus the matching `VITE_ADSENSE_SLOT_*` unit),
   **and**
2. the visitor presses *Allow ads* in the slot's consent strip.

Only then is `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js` fetched and an `<ins>` mounted;
a visitor who declines is never asked again and never loads the script. The consent flag lives in
`localStorage` under `pikachu.ads.consent` and the same behaviour is described on `/privacy`. To turn
ads on, set the variables in `.env` (or your host's dashboard) — never by adding a script tag to
`index.html`, which would load it before consent exists.

---

## Search, sharing and structured data

The app is client-rendered, so SEO work here is really two separate jobs — one for
crawlers that run JavaScript, one for everything else.

**Static shell (`index.html`)** — what a link unfurler, a non-JS crawler or a slow
phone sees: the real title and description, canonical, `robots`, Open Graph and
Twitter tags with a hand-built 1200×630 card (`public/og/pikachu-og.png`), the web
manifest and icons, and a site-level JSON-LD graph (`WebSite`, `Organization`,
`WebApplication`). Below the app root sits a generated `<noscript>` index of all
twenty-six games with followable links.

**Per route (`src/lib/seo.ts`)** — `SeoHead` runs on every navigation and rewrites
the *same* tags in place (never appending a second canonical). It owns the title,
description, canonical, OG/Twitter values and the route's JSON-LD: `WebPage` plus,
depending on the page, `VideoGame` (+`HowTo`), `BreadcrumbList`, `CollectionPage`,
`ItemList` and `FAQPage`. `/room/:code`, `/profile`, `/settings` and unknown paths
are sent out as `noindex, follow` — the room pages are infinite and private.

**Content** — the in-play rulebook is a closed disclosure, so it is not in the DOM
until someone opens it. Every game page therefore also renders `<GameAbout>` below
the board: the goal, the steps, the tip, the modes, the genre and three neighbouring
games as ordinary prose and ordinary links. `/library` carries a visible FAQ whose
questions are the *same array* the `FAQPage` markup is built from, so the page can
never promise answers it does not show.

### Files that must stay in step with the registry

```bash
npm run seo      # runs automatically before `npm run build`
```

regenerates `public/robots.txt`, `public/sitemap.xml` and the `<noscript>` block in
`index.html` from `GAMES`. Add a game, run the build, and all three update. Output is
deterministic (no timestamps), so it will not dirty the working tree — and
`src/lib/__tests__/seo.test.ts` fails if the committed files ever drift from what the
registry would produce.

### The canonical origin

The canonical origin is **`https://pikachu.invytra.in`** — the custom domain, not the
`*.vercel.app` host. It lives in `SITE_URL` in `src/lib/seo.ts`, and `npm run seo`
stamps it into `robots.txt`, `sitemap.xml` and the `<noscript>` block; the static
`index.html` head carries it too. Change the constant, the head, and re-run
`npm run seo`.

The old `pikachu-bay.vercel.app` host still resolves (Vercel keeps the deployment
URL), so `vercel.json` answers it with a **301 to the custom domain** — otherwise the
same site would be indexed at two addresses and split its own signals.

### Honest limits

Metadata, sitemaps and structured data make a site *eligible* to rank; they do not
guarantee a position, and nobody can promise first place for a query like "g".
What is actually in our control is done: unique titles and descriptions on every
route, crawlable prose on every game page, honest structured data, fast first paint
(self-hosted fonts, preloaded hero, route-split chunks), and no doorway pages. The
two remaining jobs are off-repo: verify the domain in Google Search Console and Bing
Webmaster Tools, submit `sitemap.xml`, and earn a few real inbound links.

---

## Deploying to Vercel & Cloud

### 1. Frontend on Vercel
1. Import this repository into Vercel.
2. Vercel automatically detects Vite with the included [`vercel.json`](vercel.json) (which handles client-side route rewrites for `/room/*`, `/together`, `/settings`, etc.).
3. Under **Project Settings → Environment Variables**, add:
   - `VITE_REALTIME_TRANSPORT`: `relay`
   - `VITE_RELAY_URL`: Your hosted WebSocket relay URL (see step 2 below)
   - `VITE_SUPABASE_URL`: (Optional) Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY`: (Optional) Your Supabase publishable anon key

### 2. Authoritative Multiplayer Relay
Because Vercel serverless functions are stateless and do not maintain persistent WebSockets, the authoritative multiplayer referee server (`server/index.ts`) runs on any Node.js host (Render, Railway, Fly.io, or VPS):

- **Render / Railway / Heroku**:
  - Deploy this repository as a Web Service.
  - Build command: `npm install`
  - Start command: `npm start` (runs `tsx server/index.ts`)
  - Set `RELAY_PORT` to `8787` (or default port provided by platform via `PORT` / `RELAY_PORT`).
- **Docker**:
  - A ready-to-run [`Dockerfile`](Dockerfile) is included in the root.
- **Connect frontend to relay**:
  - Copy the public service URL (e.g., `wss://pikachu-relay.onrender.com/rt`) and set it as `VITE_RELAY_URL` in your Vercel project environment variables.

### 3. Database (Supabase)
1. Create a free database at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. Copy your project URL and **Anon / Publishable Key** into Vercel environment variables (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
4. Profiles and match history will automatically sync under secure Row Level Security policies!

---

## Look and feel

The art direction is **soft, warm and romantic** rather than neon-arcade:

- **Palette** — cream paper `#FFF6E6`, butter `#FFD95A`, blush `#FFADC6`, rose `#F2779A`,
  mint `#A8E6CF`, cocoa ink `#5A3F34`. Light theme throughout, no dark mode surfaces left over.
- **Type** — Baloo 2 for display, Quicksand for body. Both self-hosted in `public/fonts`
  (two `woff2` files, preloaded) so there is no Google Fonts request and no layout shift.
- **Shapes** — rounded sticker buttons, thick cocoa outlines, soft paper shadows, floating hearts.
- **Pikachu is a real character, not an emoji.** Eight cleaned animated WebP clips live in
  `public/art/pika/`, driven by `<PikachuMascot state … />` across the ten required states (idle,
  excited, thinking, competitive, victory, defeated, waiting, sleeping, loading, error) and by
  `<PikaScene clip … />` for the three framed scene clips (Play Together, Challenges, Solo hub).
- **Game art is painted, not CSS.** Ten cover illustrations in `public/art/game/*.webp` plus the
  hero scene, served through `<GameArtwork artKey … />` with real `alt` text where the image
  carries meaning and `aria-hidden` where it is decorative.
- **Chess pieces are real artwork too.** The twelve pieces in `public/art/chess/*.svg` are the
  "Staunty" set lichess uses — transparent SVGs, so they sit on any square without a halo and
  stay sharp from 18 px in the captured row to a full square. `<ChessPiece type colour size />`
  is a single `<img>`, and the licence is recorded in `public/art/chess/CREDITS.md`.
- **Real Pokémon cries** back the key moments — 21 clips, see *Sound* below.

### Board geometry: one rule, not twenty

Every board used to size its own cells from the **viewport width** — `min(10.2vw, 62px)`
for chess, `min(5.6vw, 29px)` for River Stones, a hand-tuned `calc((75vh − 225px) / rows)`
for Pika Pairs — and hang its cream plate *outside* that width as an `-inset` overlay.
Three faults fell out of that, all of them felt rather than reported:

- **`vw` is not the space a board is in.** In a private room the board column is ~324 px
  narrower than the window (the chat is docked beside it) and the solo column is capped at
  1120 px, so the board was sized against a width it never had.
- **Height was ignored** by eleven of the twelve lattice boards, so on a 1280×800 laptop a
  chessboard pushed the clock, the controls and the rulebook below the fold.
- **Fixed px caps made a stamp of a big screen** — River Stones stayed ~360 px in a 1120 px
  column — while an `-inset-5` plate on a 360 px phone reached past the edge of the screen.

`src/components/boards/BoardStage.tsx` is now the only thing that decides how big a board
is. It measures the column it is dropped into and the room left under it, then joins them
into one number:

```
width = clamp(min, min(column, (roomUnderTheBoard − chrome) × ratio), max)
```

Cells are then fractions of that stage (`grid-template-columns: repeat(n, minmax(0,1fr))`
plus an `aspect-ratio`), so squares stay square at every size and nothing inside can push
the page sideways. Each cell is its own CSS container, so marks, crowns and coordinate
labels are sized in `cqw` — a share of the square they sit in — instead of a guess from the
window. `BoardPlate`'s frame became real padding (it can no longer be wider than the
column), `docs/board-geometry.png` plots the result at phone / laptop-with-chat-rail /
desktop, and `src/components/__tests__/board-geometry.test.ts` pins the rule, the caps and
the "no board sizes itself from the viewport" invariant.

Source GIFs were cleaned by `scripts/gifs.py` (border-seeded flood fill for background knockout,
then alpha hardening) and the covers by `scripts/art.py` (crop, composite, WebP re-encode).

---

## What is actually built

### ✅ Complete and playable

**Twenty-six games, all of which launch and finish properly.** Nothing in the library is a mock-up.

| # | Game | Solo / AI | Online (server-refereed) | What makes it real |
|---|---|---|---|---|
| 1 | **Chess Arena** | ✅ 5 tiers | ✅ | Alpha-beta negamax in a Web Worker: quiescence search, MVV-LVA ordering, killer moves, piece-square tables, iterative deepening on a time budget. Clocks (3+2 / 10+5 / 30+10), SAN history, take-back, resign, draw offers, promotion chooser. |
| 2 | **Tic-Tac-Toe Duel** | ✅ 5 tiers | ✅ | Exact memoised minimax; 3×3/4×4/5×5 boards. The expert tier is unbeatable, and the test proves it exhaustively rather than by sampling — it walks *every* opponent reply from both seats. |
| 3 | **Four in a Row** (Connect Four) | ✅ 5 tiers | ✅ | Iterative-deepening minimax with threat detection and a move explanation feed. |
| 4 | **Pika Pairs** | ✅ 5 tiers | ✅ | Solo / vs AI / same-device / co-op. The AI has a real, lossy memory model per difficulty. Server redacts face-down cards. |
| 5 | **Spark Reflex** | ✅ 5 tiers | ✅ | Signal timing is owned by the server clock, never a local timer. False starts, per-round log, calibrated human-like AI reflex distribution. |
| 6 | **Snake Arena** | ✅ 5 tiers | — | Grid engine with a BFS-pursuit AI serpent guarded by flood-fill survivability. Four pastel skins, pillars, wrap walls, canvas renderer, boosts. |
| 7 | **Paper Fleet** (Battleship) | ✅ 5 tiers | ✅ | Hunt/target AI with parity sweeping. Manual or auto fleet placement. The server never sends the enemy fleet to your browser. |
| 8 | **Checkers Royale** | ✅ 5 tiers | ✅ | Mandatory capture, chain jumps, kings, resign. |
| 9 | **Puzzle Quest** | ✅ solo | — | Five chambers — Shard Slide, Circuit Grid, Volt Lock, Pattern Echo, Volt Sum — every one generated *from a known solution*, so it is always solvable (tested, including 15-puzzle parity). |
| 10 | **Volt Runner** (arcade) | ✅ solo | — | Canvas endless runner down a sunset meadow lane: charges, hay bales, birds, shields, magnets, combo chain, escalating waves. |
| 11 | **Spark Quiz** (trivia) | ✅ 5 tiers | ✅ | Science, history, general knowledge and mental maths. 78 hand-written questions plus a **maths generator**, so that category never repeats and the tiers differ by the actual arithmetic. The rival's accuracy is measurably tiered (35% at beginner → 92% at expert) and the test asserts the gap. Online it is *simultaneous*: both of you answer the same question at once, the server owns the clock, and neither browser is told what the other picked until the question closes. |
| 12 | **Wild Eights** (cards) | ✅ 5 tiers | ✅ | Crazy Eights on a real 52-card deck: suit/rank following, eights as wilds that rename the suit, stacking twos, skips, and a stock that reshuffles from the pile. The AI hoards its eights, times its skips, and remembers which suits you failed to follow. Online, the server deals and the hands are redacted — neither browser is ever sent the other's cards. |
| 13 | **Detective Pikachu** (detective) | ✅ 5 tiers | — | Procedurally generated mysteries. Every case is brute-force checked to admit **exactly one** (who, where, what) answer, then pruned so no clue on the board is redundant — both properties are asserted over 450 generated cases. |
| 14 | **Imposter** | ✅ 3–8 local | — | Pass-the-phone secret roles. Everyone sees the word except the imposter (optional decoy word), clue rounds, voting with tie handling, and a one-guess steal if they are caught. |
| 15 | **Truth or Dare** | ✅ 2 local | — | A 72-card deck at three heat levels written for two people. The spicy deck is behind its own explicit switch, piles never repeat until exhausted, and every card can be passed with no penalty. |
| 16 | **Guess & Draw** | — | ✅ | One of you gets a word and ninety seconds, the other gets the canvas and a text box, and you swap every round. The word bank is **stripped from the state entirely** before it leaves the server; the guesser is sent a mask with one underscore per letter and nothing else. Guessing is typo-tolerant on longer words (one edit) but exact on short ones, so `bat` never wins a round about a `cat`. A faster guess is worth more, the drawer scores too, and strokes are validated server-side — bad coordinates, bad colours and flood attempts are rejected rather than drawn. |
| 17 | **Lantern Flip** (Reversi) | ✅ 5 tiers | ✅ | Standard Othello rules: eight directions, the move must bracket at least one enemy disc, and a player with no legal move is forced to pass — if both pass, the discs are counted. Boards 6×6 / 8×8 / 10×10. The AI is negamax with an alpha-beta window and the classic corner/edge/mobility weights that make it genuinely unpleasant at the top tiers. The board glows the discs it is about to flip *before* you commit. |
| 18 | **River Stones** (Gomoku) | ✅ 5 tiers | ✅ | Freestyle five-in-a-row on 15×15, with 13×13 and 11×11 for a phone. Forced wins are searched properly: the AI scores open threes and fours rather than just counting neighbours, so it blocks a developing line instead of admiring its own. The winning five is drawn as a single river through the stones. |
| 19 | **Dots & Boxes** | ✅ 5 tiers | ✅ | The pencil-and-paper classic with the rule that makes it a game: closing a box scores it and keeps the turn. Chains, double-crosses and the parity endgame are all real — the AI counts how many boxes it hands over. Boards 4×4 to 6×6 with an undo-safe move log. |
| 20 | **Mancala** (Kalah) | ✅ 5 tiers | ✅ | Sow counter-clockwise, your own store takes a seed, the last seed in your store earns another turn, and landing opposite an empty pit captures both. The endgame sweep is implemented, and the AI searches captures and extra turns rather than greedily grabbing seeds. Pits 4/5/6/7. |
| 21 | **Would You Rather** | ✅ 5 tiers | ✅ | One of you answers honestly, the other bets on the answer, then you swap. The dilemma never repeats inside a match, and the opponent's choice stays on the server until both have locked in — a client is only ever told *that* a pick exists. |
| 22 | **Word Bomb** | ✅ 5 tiers | ✅ | A letter is lit and the fuse burns down on the server clock. Your word has to start with that letter, and its last letter lights the next one. A repeat or a wrong letter is a strike; two strikes and it goes off. The relay ticks the fuse, so a silent opponent cannot stall it. |
| 23 | **Daily Puzzle** | ✅ solo | — | A 5×5 nonogram generated from the date, so everybody who opens the page that day gets the same grid with no server and no cache to peek at. The share line reports the time and the streak without spoiling a single cell. |
| 24 | **Berry Catch** | ✅ solo | — | A canvas field, a basket you move, and ripe berries falling past rotten ones. Streaks multiply the score up to five, a rotten berry costs a life, and the field is seeded so a run can be replayed. Thirty, sixty or ninety seconds. |
| 25 | **Bluff Trivia** | ✅ 5 tiers | ✅ | Everybody writes a plausible lie to a real question, then the ballot mixes both lies with the truth. Two points for finding the truth, one for every player you fooled — and your own lie is never votable. Writing and voting both close on the server's clock. |
| 26 | **Spyfall** | ✅ 3–8 local | — | One phone, passed round behind a curtain: every agent sees a role and the location, the spy sees neither. Question each other, then vote in secret. A tie accuses nobody, and a spy who survives it gets one guess at the place for a bonus. |

**Online play (the core feature)**
- Private rooms with a 5-character code (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no confusable glyphs) and a shareable invite link.
- Explicit room state machine: `WAITING → READY_CHECK → STARTING → IN_GAME → COMPLETED`, plus `CANCELLED / EXPIRED / DISCONNECTED`.
- Lobby with seats, ready-up, host-only start, live settings, in-room match history and a series score.
- Countdown, result screen, rematch voting with automatic side-swap.
- Reconnection holds your seat for 45 s; the room itself expires on a timer.
- **Server authority**: every move is validated by the *same* `rules.ts` module the browser imports. The relay does not hold its own copy of the rulebook: it imports `REFEREES` from `src/games/referees.ts` (`const RULES = REFEREES`), so a game cannot be advertised as online unless the referee for it exists — `catalog.test.ts` asserts exactly that. Stable match IDs, per-player sequence numbers, idempotent actions, `stale_match` rejection, rate limits on create/join/nudge.
- **Arena chat**: one surface, three placements. On desktop it is *docked beside the board*
  (and in the lobby's right column), so it can never cover a piece, a clock or the result card.
  On a phone it is a peek bar above the safe area that expands into a sheet leaving the board
  visible. Consecutive messages from one person group together and timestamps collapse into
  five-minute dividers; joins, game switches, match starts and results arrive as centred system
  lines. The eight reactions are drawn as inline SVG stickers (`lib/chatFeed.ts` maps the label,
  and still recognises the emoji form older messages used), so nothing depends on which emoji
  font the reader's OS ships. The log is a `role="log"` polite live region, the composer is a
  labelled textarea with a 44 px send button, Enter sends and Shift+Enter breaks the line, and a
  throttled `typing` message (one per ~1.5 s, relayed to the opponent only) drives the "is
  typing" trio. Grouping, dividers, ordering and reaction recognition live in `lib/chatFeed.ts`
  and are covered by 17 unit tests.
- **No hidden-info leaks**: `redact(state, slot)` runs before every broadcast — a Paper Fleet client is never sent the enemy fleet, a Memory client is never sent the face-down deck, a Wild Eights client is sent `-1` placeholders for the opponent's hand and the whole stock, a Guess & Draw client is sent a row of underscores instead of the word (and never the bank the rest of the match is drawn from), and a Spark Quiz client is told only *that* the other player has locked in, never *what* they picked — plus the unasked questions are withheld so nobody can read ahead. `scripts/smoke-cards.ts` asserts this on the wire, and `scripts/e2e/online-cards.mjs` asserts the other player's cards appear nowhere in your tab's DOM.

**The rest**
- **Cold open** (plays once per session, 3.2 s, 1 s with reduced motion): a lit room rather than a
  gradient — warm paper, house lights coming up, out-of-focus game covers drifting at the back of
  shot, and a floor whose top edge is the horizon. **Pikachu runs in from the left along that
  horizon** (the pixel-art `run` clip, upscaled no further than its native 300 px so `image-rendering:
  pixelated` keeps the edges crisp), skids to a stop as the strike lands, and then runs on the spot
  while the ground streams backwards under him — his clip has no idle, so the ground moves instead
  of the character. Then the wordmark, one letter at a time, and the opening cry. There is no skip
  button on purpose — a skip button on a three-second splash is an admission that it is too long,
  so the sequence was tightened instead. Nothing in it is interactive, so reduced motion changes
  only the animation, never the flow.
- Home hub: a hero that puts the wordmark, one clear primary action, the private-arena ticket and the trainer
  stub above an unframed, full-bleed picnic horizon with Pikachu standing on it; then quick-continue, daily
  challenges, the four rotating game rails, the invite banner and the library strip. `src/components/HomeHero.tsx`
  holds the hero on its own and `docs/hero-preview.png` shows the composition at 1440 px and 390 px — drawn
  from the same fonts, colours and artwork, because this environment has no browser to screenshot.
- Game Library with working search, mode/genre filters, sort (featured / name / duration / most played), favourites and recents.
- Solo Adventures hub, Challenges, Achievements (16 badges, all awarded from real match data), Profile, Settings.
- Honest loading: `ElectricLoader` is indeterminate unless a real `progress` number exists. There are no artificial delays anywhere.
- **A suggestion box that does not lose your note.** `/feedback` takes a review, a game idea, an
  improvement or a bug report — four kinds, one short form, stars only when it is a review, and a
  name and contact folded away behind a disclosure. A note is written to the device *first* and only
  then sent to Postgres, so a missing key, a dropped connection or a closed tab never eats it: the
  page tells you it is queued and the queue drains by itself the next time cloud sync works.
  Published reviews appear on the page (the wall), which is readable without an account.
  Details and the moderation rules are under *Reviews & ideas* below.
- **Every game explains itself, in place.** `src/games/howToPlay.ts` holds a card for all twenty-six
  games — the goal in one sentence, the numbered rules, and the tip that actually changes how you
  play it ("hand over the third side of a box and you have given your opponent a present"). The
  card renders as a disclosure under the board in solo play and in the room, and in the lobby
  before the first move, so nobody has to leave the game to find out how it works.
- **Pass-and-play has a curtain.** On Wild Eights played on one device, the moment the seat changes
  the board, the hand and the log are covered by an opaque card that says whose turn it is and refuses to lift
  until that player has taken the device. Previously the next player's hand was visible the instant
  the turn changed, which quietly broke every hot-seat card game.
- Accessibility: full keyboard play, visible focus rings, ARIA labels on every board cell, a polite
  live region on the in-room turn pill (so "your move" is announced instead of being a colour
  change), dialogs with `role="dialog"` + focus handling, and no state signalled by colour alone.
- Responsive from 360 px phones to ultrawide, with a bottom nav and touch D-pads on mobile.
  `scripts/e2e/mobile.mjs` loads all nineteen games that have a solo view at 390×844 and asserts **zero** horizontal
  overflow, no undersized tap target, a **sticky-chrome budget of 150 px**, and that the playfield
  is actually on screen. It uses two tap-target bars rather than one, because they are two
  different questions: board squares are held to the WCAG 2.5.8 (AA) floor of 24×24 — a 15×15
  River Stones lattice on a 390 px phone physically cannot have 44 px cells and still be one board;
  the new geometry gets it to ~23 px where the old `vw` maths gave ~17 px — while all other controls
  are held to a 32 px comfort floor. The last full run before the four new boards were added was **15/15 clean**; the new boards are in the list now and `npm run e2e` re-measures all nineteen.
- Instruction copy follows the input device (`src/lib/useTouch.ts`, `(pointer: coarse)`). A phone is
  never told to press space or an arrow key.
- Volt Runner re-tunes itself for the screen (`tuneFor` in `src/games/arcade/SoloView.tsx`): a phone
  sees less road but proportionally slower, so the time between an obstacle appearing and reaching
  you is identical on every device. `scripts/e2e/runner.mjs` runs its whole bot suite twice, once at
  1180×860 and once at 393×727 (`--phone`), and the bot reads the live tuning rather than hardcoded
  constants — **22/22 at both sizes**.

### 🟡 Partial / deliberately scoped

- **Cloud sync** is optional and off until you add Supabase keys. Without them the app is fully functional but local to one browser.
- **Snake, Puzzle Quest, Volt Runner, Detective Pikachu, Imposter, Spyfall, Berry Catch, Daily Puzzle and Truth or Dare are offline games** — single-player or same-device. They are not listed as online anywhere in the UI; only the **seventeen** server-refereed games are.
  - *Imposter* and *Spyfall* need 3–8 seats and rooms seat exactly two, so they cannot go online without reworking the room model. Both are pass-the-phone games for that reason, and say so where you pick them.
  - *Truth or Dare* and *Detective Pikachu* have no competitive outcome for the relay to referee.
  - *Snake*, *Puzzle Quest* and *Volt Runner* are real-time single-player; refereeing them would mean streaming every frame, which is the thing this project deliberately does not do.
- **Match history across sessions** is kept by the relay in `.pikachu-data/matches.json` (dev convenience) and per-device in `localStorage`. There is no global leaderboard.
- **Presence** shows your own connection quality and whether a room is live. It does not poll a directory of online friends — there is no user directory.

### ❌ Not implemented (on purpose, stated plainly)

- No voice or video chat. Text chat exists (`src/components/RoomChat.tsx`) with quick reactions,
  typing presence and screen-reader announcements — see *Arena chat* below. It has no message
  history, no file uploads and no moderation tooling yet, so treat it as a friendly room chat,
  not a social network.
- No spectators. Rooms seat exactly two.
- No mobile app wrapper, no push notifications.
- No ELO/global ranking, no matchmaking with strangers — this is a private two-player arena.
- No visual-regression screenshots. The browser suite asserts on the DOM, console and network; it does not compare pixels.

---

## Reviews & ideas

`/feedback` is the only inbound channel: one form with four kinds of note.

| kind | asks for | goes where |
|---|---|---|
| **A review** | stars 1–5 + a sentence | shown on the wall on this page, once posted |
| **A game idea** | the game, and what the two players do on a turn | read and triaged by hand |
| **An improvement** | what is clunky or confusing, and what you expected | read and triaged |
| **Something's broken** | what you tapped, what happened, what should have happened | first in the queue, because a broken game is worse than a missing one |

**Nothing requires an account,** and nothing is shared anywhere else in the app.

### It works with or without Supabase

The table behind this is `public.feedback` (`supabase/migrations/0003_feedback.sql`), and the client
is `src/lib/feedback.ts`. The order of operations is deliberate:

1. validate in the browser (so the error appears under the field, not as a 400),
2. write the note to `localStorage` **immediately**,
3. try the insert,
4. on success mark it `sent`; on a transient failure leave it `queued` and say so on the page.

With no Supabase project configured — the default — step 3 is skipped and every note stays on the
device with an honest line under the form saying exactly that. `flushFeedbackQueue()` runs on boot,
so the moment a project *is* connected, anything queued is delivered and the queue line clears.

### What the database enforces itself

The anon key is public, so none of the client-side rules count for anything. The migration restates
every one of them, and adds the things a browser cannot do:

- **CHECK constraints** — message 8–1200 characters, rating 1–5, a review must have a rating and
  nothing else may have one, name ≤ 40, contact ≤ 120.
- **Column-level grants** — `anon` may `insert` eight named columns and `select` seven. `contact`,
  `device_id`, `user_id` and `status` are not readable by the browser at all. RLS filters rows; only
  column grants can stop a *field* leaking, which is why both are used.
- **RLS** — insert allowed only with `status = 'published'` and either no `user_id` or your own;
  select allowed only for published rows. There is deliberately **no update or delete policy**, so a
  note can only be hidden in the SQL editor: `update public.feedback set status = 'hidden' where id = …`.
- **A server-side rate limit** — a `security definer` trigger refuses the sixth note from one device
  in an hour, and any note at all when more than 120 have arrived in ten minutes. The client has the
  same per-device limit for a nicer message; the trigger is the one that counts.
- **Hardened chat logs** — `0002` shipped `room_messages` with `using (true)` and `with check (true)`,
  which on a public anon key means *read every room's chat and write anything you like into it*. The
  browser now has insert-only access with length checks and no `select` grant at all. The relay
  remains the authoritative copy; the table is a mirror you read in the dashboard.

### Also fixed while looking at Supabase

Signing in on a second device restored your name and mascot but left the career page reading zero,
because `fetchRemoteUserData()` returned per-game stats that nothing consumed. `mergeRemoteStats()`
now folds them in **field by field with `max`**, so a stale cloud row can never roll back a session
you just played offline, and the same merge runs on boot when a session is already stored.

---

## Sound

Two layers, in `src/lib/audio.ts`:

1. **A soft synthesised layer** — Web Audio oscillators for UI clicks, piece moves, drops, hits and
   the two slow ambient pads. Zero bytes of network transfer.
2. **Real voice clips** for the moments that deserve one, from `public/audio` (23 files, 248 KB
   total). **Pikachu himself now carries every load-bearing cue** — eight clips cut from royalty-free
   Pikachu recordings — and the rest of the cast fills the supporting cues so two adjacent events
   never sound identical.

| Cue | Clip | Fires on |
|---|---|---|
| `win` | `pika-echo.mp3` | your victory — the yell, with the echo tail |
| `lose` | `pika-chu.mp3` @0.78× | defeat: the same voice, slowed and dejected |
| `go` | `pika-pika.mp3` | a match starting |
| `achievement` | `pika-joy.mp3` | a new trophy |
| `countdown` | `pika-cry-retro.ogg` 0–0.18s | each beat of a 3-2-1, clipped and quiet |
| `jump` | `pika-hop.mp3` (0.39s) | hopping an obstacle in Volt Runner |
| `move` | `pika-hop.mp3` 0–0.22s @0.92× | a chess or checkers move — just the "pi" |
| `pickup` | `pika-yay.mp3` 0–0.5s | a charge collected in Volt Runner |
| `hit` | `pika-zap.mp3` | a shot landing — the attack cry |
| `notify` | `pika-ask.mp3` | a toast appearing — a questioning "pika?" |
| `sunk` | `pika-gmax.ogg` 0.54–1.16s | sinking a ship — the Gigantamax cry's finale only |
| `power` | `raichu.mp3` | a power-up — evolved, so a bigger voice |
| `draw` | `clefairy.ogg` | a dead heat |
| `place` / `drop` | `pawmi.ogg` / `fidough.ogg` | a mark placed, a disc dropped |
| `flip` / `coin` | `pichu.mp3` @1.12× / @1.3× | turning a memory card, scoring a point |
| `miss` | `marill.ogg` @0.9× | a shot missing |
| `capture` / `check` | `togedemaru.ogg` / `mimikyu.ogg` | taking a piece, giving check |
| `block` | `minun.ogg` | a blocked or losing exchange |
| `zap` / `spark` | `emolga.ogg` / `plusle.ogg` | the speed bolt, a nudge |
| `join` | `eevee.mp3` | the other seat filling |
| `boot` | `pika-chu.mp3` | the arcade opening — the cold open's wordmark landing |
| `open` | `pika-yay.mp3` 0–0.5s | a game opening — a short "pika-chu" hello |
| `error` | `jigglypuff.ogg` | a rejected action |

`hover`, `click`, `select`, `toggle` and `swipe` are deliberately **synth-only**. A character voice
on every mouse movement is unbearable inside a minute, and a unit test asserts they stay that way.

**The opening cry and the autoplay gate.** A browser will not let Web Audio speak before a gesture,
and most visitors watch the first second of the cold open without touching anything — so a cry fired
at the title beat was silent for almost everyone. The intro therefore *asks* for it (`wantOpeningCry`)
and `unlockAudio()` fires it on the first pointer or key event, after the clip has decoded. Landing
in a game asks for the shorter `open` cue instead, which is the same voice answering the click.

### Why the arcade sounded wrong

The first pass simply pointed cues at downloaded files, and it sounded cheap for three reasons that
no type-checker can see:

- **Leading silence.** Every raw rip opened with 0.1–0.5s of dead air. The cue fired on the frame
  you jumped, but the voice landed a third of a second later, so it read as lag rather than sound.
- **Unmatched loudness.** Peak amplitudes across the set ranged from 0.16 to 0.60 — nearly 12 dB —
  so the sequence of events in a single run lurched between inaudible and startling.
- **Clips longer than the gap between events.** Volt Runner fires `jump` about every 1.5s. A 1.2s
  cry is still ringing when the next one starts, and overlapping copies of the same voice is exactly
  what "weird" sounded like.

`scripts/voices.py` is the fix and is kept in the repo: it trims the lead-in at a real amplitude
threshold, peak-normalises every clip to −1 dBFS, applies 12 ms / 30 ms fades so no clip starts or
ends on a discontinuity, and encodes mono 64 kbps. Eight clips, 68 KB. Cue selection then respects
the event rate — the fastest cue in the game gets the shortest clip there is.

A `CrySpec` can carry `offset` and `dur`, which take a slice out of the decoded buffer. That is how
one file yields several distinct utterances, and why `move` and `jump` can share a source without
sounding the same. Slicing beats shipping chopped-up files: the browser has already decoded the
buffer, so a slice costs nothing. Slices fade out over their last 30 ms, because a hard cut
mid-waveform clicks.

Cries are fetched and decoded lazily on the first real gesture, cached forever, and rate-limited
per cue so a fast flipper can never machine-gun them. If a clip fails to load the synth layer
covers that cue silently — audio never throws.

---

## Performance

Target: smooth on an integrated-GPU 16 GB Windows laptop.

- **Route and engine splitting.** Every screen and every game view is its own chunk.
- **Idle prefetch** (`src/lib/prefetch.ts`). Once the hub is interactive, the likely-next chunks are
  warmed one per idle slice, cheapest first. Skipped entirely on `saveData` or a 2G connection.
- **Intent prefetch.** Hovering, focusing or touching a game card starts that game's chunk
  immediately, so the click usually lands on an already-parsed module.
- **Pre-warmed chess worker.** Spawning a module worker is the slowest single step in opening Chess
  Arena, so it happens during idle time and the view adopts the existing instance.
- **Supabase is dynamically imported** and only when both env vars are set.
- Quality tiers (Performance / Balanced / High) chosen by a device probe, `prefers-reduced-motion`
  respected, canvas loops suspended on `document.hidden`, DPR clamped to 1 in performance mode,
  and every interval, listener, subscription and worker torn down on unmount.

---

## Architecture

```
server/
  protocol.ts         wire types shared by client and server
  index.ts            authoritative relay: rooms, state machine, ticking, persistence
src/
  games/
    types.ts          TurnGameRules<S, M> — the one contract both sides implement
    registry.ts       all twenty-six games, their modes, art keys and difficulties
    <game>/rules.ts   pure rules — imported by BOTH the browser and the server
    <game>/ai.ts      the opponent for that game
    <game>/SoloView.tsx  the single-player screen
    referees.ts       the relay's rulebook: id → rules, imported by server/ and by tests
    views.ts          id → lazily imported SoloView, read by Solo.tsx *and* lib/prefetch.ts
    howToPlay.ts      the rules card for every game, rendered by components/HowToPlay.tsx
  components/boards/  presentational boards: {state, youSlot, onMove, interactive, names}
    BoardStage.tsx    the one sizing rule: column + headroom → stage width (fitBoardWidth)
    BoardPlate.tsx    the cream table every board sits on (padding, never an overlay)
    registry.tsx      id → board component, the one map Room.tsx renders from
  components/artManifest.ts  artKey → cover file, importable without React
  workers/            chessEngine.worker.ts — search off the main thread
  mascot/             PikachuMascot (clip-driven), PikaScene, loaders, confetti
  lib/                store, identity, settings, progress, audio, prefetch, relay client, supabase
  screens/            Intro, Home, Library, PlayTogether, Room, SoloHub, Solo, …
public/
  art/pika/           8 cleaned animated WebP mascot clips
  art/game/           20 painted game covers · art/scene/ the hero painting
  audio/              21 Pokémon cries  fonts/  2 self-hosted woff2
supabase/migrations/  SQL with RLS for the optional cloud layer
scripts/gifs.py       GIF → clean animated WebP   scripts/art.py  cover crop/composite/encode
scripts/smoke.ts      end-to-end relay test (two WebSocket clients, no browser)
scripts/e2e/          browser tests: routes.mjs, play.mjs, reconnect.mjs
```

Two rules that keep the whole thing honest:

1. **Boards are presentational.** The same `ChessBoard` renders a local AI game and an online
   game; only the state source differs. That is why online and solo cannot drift apart.
2. **The server imports the rules, it does not reimplement them.** If a move is illegal in the
   browser it is illegal on the server, by construction.

### Difficulty is real

Every tier changes actual search behaviour, not cosmetics:

| Tier | Chess | Connect Four / Checkers | Paper Fleet | Reaction |
|---|---|---|---|---|
| Beginner | depth 1, 120 ms, 45 % deliberate blunder | depth 1 | random with parity off | ~520 ms mean |
| Casual | depth 2, 260 ms, 18 % | depth 2–3 | parity hunting | ~400 ms |
| Intermediate | depth 3, 620 ms, 5 % | depth 4–5 | hunt/target | ~320 ms |
| Advanced | depth 4, 1.3 s, 1 % | depth 6–7 | + probability map | ~255 ms |
| Expert | depth 6, 2.6 s, no blunders | full budget | full density map | ~205 ms |

Nothing calls a language model to pick a move. Everything runs locally and finishes in milliseconds.

---

## Retro Arcade (Game Boy Advance)

`/retro` is a shelf of real Game Boy Advance cartridges running in the browser on
**EmulatorJS 4.2.3** with the **mGBA** core. It is deliberately separate from the
twenty-six games above: those are written for this site, these are actual `.gba`
binaries executed by a WebAssembly emulator.

### What is on the shelf

| Cartridge | Author | Licence | ROM | Genre |
|---|---|---|---|---|
| **Alien Invasion** | amberephraim | MIT | 63 KB | shooter |
| **Cyber Citadel** | amberephraim | MIT | 9.5 MB | side-scroller |
| **Simple Frogger** | amberephraim | MIT | 47 KB | arcade |
| **Lander Advance** | edefelice | MIT (code) · CC BY 4.0 (art, audio) | 255 KB | physics sim |
| **Pong** | ZeroDayArcade | MIT | 8.7 KB | arcade |
| **Wigly Hunt** | rawbits2010 | GPL-3.0 | 56 KB | arcade |
| **Xorlix** | egillespie | MIT | 37 KB | puzzle |

Every one is a freely redistributable homebrew build from a public repository —
`public/retro/roms.json` links each entry to its source and its licence, and the
licence text is committed alongside the ROMs in `public/retro/licenses/`
(`NOTICE.txt` is the per-cartridge provenance list). **No commercial ROMs are
hosted, downloaded or bundled anywhere in this repository** — not from a ROM
site, not as a "sample", not behind a flag.

The cover images are not artwork anyone drew: each one is a 240×160 frame the
emulator itself produced while that cartridge was running, screenshotted from the
canvas at 2× and committed at the GBA's native size. Cards with a `marquee` entry
cross-fade to a second frame on hover.

### How it is wired

```
public/retro/
  player.html          the emulator document (served as a plain static file)
  roms.json            the shelf — the only source of cartridge ids and paths
  data/                EmulatorJS runtime: loader.js, emulator.min.{js,css},
                       compression/, localization/en-US.json,
                       cores/mgba-wasm.data + cores/reports/mgba.json
  roms/*.gba           the cartridges
  covers/*.png         real captured frames
  licenses/*.txt       MIT texts for the ROMs and for EmulatorJS
src/lib/retro.ts       manifest validation, cartridge-header check, shared types
src/screens/Retro.tsx  /retro — the searchable shelf
src/screens/RetroPlayer.tsx  /retro/:id — the console
scripts/e2e/retro.mjs  the proof (see below)
```

* **The emulator is an iframe, and only on the player route.** EmulatorJS is a
  classic script bundle that measures the whole document as its viewport, so it
  gets its own document (`/retro/player.html`). React never imports it.
* **Nothing emulator-shaped is fetched until a cartridge launches.** `/retro`
  loads the manifest and one small PNG per card. `data/loader.js`, the 1 MB core and
  the ROM are requested only when a player page mounts — `retro.mjs` asserts
  this by watching the network log.
* **Ids are validated twice.** `loadRetroLibrary()` checks each manifest row
  against a strict shape (id slug, `roms/<slug>.gba`, `covers/<slug>.png`,
  `https` source, a sane byte count and accent colour) and drops anything that
  fails; `player.html` re-resolves the `?game=` id against the same manifest, so
  a hand-edited URL cannot point the emulator at a remote file.
* **Your own ROM never leaves the device.** Both entry points — the file picker
  and a drop on the "your own cartridge" card — read the first 0xC0 bytes, check
  the Nintendo logo the GBA boot ROM itself checks for, then hand the `File` to
  the player through route state. The player turns it into a `blob:` URL in
  memory. No request is made, nothing is written to storage, and a reload forgets
  it — `retro.mjs` asserts both the boot and the absence of an upload.
* **There is no "paste a link to a ROM" box, on purpose.** A URL importer would
  be blocked by CORS on almost every host, and where it did work it would make
  this site a download proxy for exactly the commercial ROM sites it refuses to
  touch. The honest version of that affordance is the drop zone: you supply the
  file you are allowed to play, and it stays in your tab.

### Controls

Mapping is EmulatorJS's GBA default, and every row below was pressed in a real
browser against a real ROM before it was printed on the page:

| Keys | Button |
|---|---|
| Arrow keys | D-pad |
| Z | A |
| X | B |
| Enter | Start |
| V | Select |
| Q / E | L / R |

The console's own plastic is wired to the core: every button on the shell — D-pad,
A/B, Select/Start — sends `simulateInput` calls straight to the engine, the same
call a hardware controller produces. They are real `<button>`s, so they work with
a thumb, a mouse, or the keyboard (tab to one and hold Space). Connected
controllers are picked up via the browser Gamepad API; if a pad was already
plugged in when the page loaded, `player.html` claims it for player 1, because
EmulatorJS dispatches its `connected` event for pre-existing pads before it has
attached its own listener.

### The console is the page

`/retro/:id` is not a video player with a frame around it: it is a handheld that
occupies the viewport, and the emulator's canvas is its screen.

* **The proportions are traced, not invented.** The shell, bezel, LCD, D-pad,
  button spacing, silkscreen and speaker slots are measured off a reference
  photograph of a DMG-style handheld and expressed in `cqw` against the shell's
  own width, so the whole device scales as one object from a 386px phone to a
  630px fullscreen laptop. There is one set of numbers and no breakpoint
  approximations of the shape.
* **The screen is exactly 3:2**, the GBA's own ratio, so the picture fills the
  LCD edge to edge with no letterboxing — `retro.mjs` measures the canvas against
  the hole and fails if they differ by more than 2px.
* **The site's own header and bottom bar step out.** The player draws a slim bar
  (title, state, keys, info) and a rail (pause, save, load, restart, mute,
  capture, fullscreen); two navigations above a running emulator would be chrome
  competing with the console.
* **Fullscreen gives the whole screen to the device.** Press fullscreen and the
  header and rail step away, the shell grows to fill the glass (+~100px of
  width), and a floating *Exit fullscreen* button appears — the rail is gone, so
  leaving cannot be a guess about the Esc key.
* **Landscape phones get the picture, not a miniature.** Below 560px of height
  the artwork would leave a 130px screen, so the LCD fills the viewport and the
  working D-pad, A/B and Select/Start sit in the black margins either side of it,
  at thumb size.
* **The battery lamp tells the truth** — unlit while booting, lit while the core
  runs, dimmed when paused.

### Verified, and how to re-verify

```
npm run build && npm run preview        # or: npm run dev
node scripts/e2e/retro.mjs              # desktop
node scripts/e2e/retro.mjs --phone      # touch emulation
```

`scripts/e2e/retro.mjs` drives a real Chromium: shelf search and filters, launch,
the start gesture, audio-context state, keyboard, synthetic-controller *and*
on-shell button input asserted against captured `simulateInput` calls, the canvas
filling the LCD, pause/resume, save/load, PNG capture, mute, restart, fullscreen
entry and exit (including that the shell grows and that a way out stays on
screen), every cartridge booted and asserted to paint a live frame, the drop-a-file
and pick-a-file local-ROM paths (including refusing a file that is not a GBA), plus
a layout overflow check on a phone profile. It needs a real
browser with WebGL2; on a machine whose Chromium lacks `libnss`/`libnspr`, pass
`PIKACHU_CHROME=/path/to/chromium PIKACHU_LD=/path/to/libs`.

### Limitations, stated plainly

* **Save states, not battery saves.** Save/load lives in the browser's own
  IndexedDB, per cartridge. None of the seven cartridges writes battery-backed
  save data, so progress beyond a save state does not persist — the player says
  so on the page.
* **No BIOS file.** The mGBA core boots these builds directly; some commercial
  cartridges are stricter, which is a non-issue here because none are hosted.
* **Audio needs one click.** The Start button over the screen is also the
  gesture that unlocks WebAudio. After that press, sound runs for the session.
* **`EJS_threads` is deliberately off.** Threads would need COOP/COEP headers
  across the whole site, which would break the rest of the arcade. GBA runs
  comfortably single-threaded.
* **`/retro/<id>` is `noindex`.** It renders nothing until ~1.5 MB has
  downloaded, so the shelf (`/retro`, which is in the sitemap and carries the
  structured data) is what search should rank.
* **EmulatorJS checks for updates on localhost only.** That produces one
  harmless console line in dev ("Failed to fetch" for `cdn.emulatorjs.org`);
  production is silent and makes no third-party request.

### Rebuilding the vendored runtime

`emulator.min.js` / `emulator.min.css` in `public/retro/data/` were produced
from the unminified sources of the published npm packages (EmulatorJS 4.2.3
ships no minified build) with terser, concatenating
`emulator, nipplejs, shaders, storage, gamepad, GameManager, socket.io.min,
compression` in that order — the same order `loader.js` uses for its own
fallback. The 1 MB core is `@emulatorjs/core-mgba@4.2.3`'s `mgba-wasm.data`.
Nothing at runtime reaches the network for these files.

EmulatorJS is MIT — `public/retro/data/LICENSE-EmulatorJS.txt`.

---

## Tests

```
npm test
```

607 tests across 42 files covering: legality and junk-payload rejection for all seventeen
server-refereed games, win/draw detection, fool's-mate, promotion, clock flagging, take-backs,
mandatory capture and promotion in checkers, memory redaction and streaks, fleet placement
validation plus a full AI-vs-AI battle, reaction-duel timing on a real clock, snake
collision/growth/wrap, puzzle solvability (including 15-puzzle parity), and the XP /
achievement / daily-challenge system.

The party shelf carries its own suites, because those are the games where a bug is invisible until
somebody at the table is embarrassed. Would You Rather and Word Bomb have rule tests plus a relay
test each. Bluff Trivia checks that the truth is never named while the ballot is open, that your own
lie cannot be voted for, and that the deadline closes the vote without a nudge. Spyfall checks that
every deal has exactly one spy, that the spy holds no role card, that a tie accuses nobody, and —
driven through the real screen — that a closed card never carries the previous player's identity.
Berry Catch and Daily Puzzle test their engines and their screens separately.

The four newest games (Reversi, Gomoku, Dots & Boxes, Mancala) add their own rule tests: forced
passes and the wipe-out ending in Reversi, five-in-a-row in every direction plus the overline case
in Gomoku, the extra-turn/chain rule and the box count in Dots & Boxes, and the store-extra-turn,
opposite-pit capture and endgame sweep in Mancala. Each of the four AI tiers is played against the
tier below it to confirm the ordering is real rather than cosmetic.

`src/lib/__tests__/seo.test.ts`, `seo-dom.test.ts` and `src/components/__tests__/seo-content.test.ts`
guard the search-facing surface the same way: every game gets a unique, length-checked title and a
description built from its own rules; private and device-local routes stay `noindex`; the sitemap and
the committed `<noscript>` index must match what the registry would generate today; `applySeo` may
only ever leave one canonical, one description and one JSON-LD script behind; and the FAQ rendered on
`/library` has to be the same array the `FAQPage` markup is built from.

`src/games/__tests__/catalog.test.ts` is the guard rail around the *catalogue itself*, and it exists
because every bug of this kind is a consistency bug rather than a logic bug. It asserts that game
ids and slugs are unique, that every entry is complete, that every game marked online has a referee
which produces a legal opening move **and** a board component, that every solo-capable game has a
`SoloView.tsx` on disk and that no orphan view exists, that every `artKey` resolves in the art
manifest to a file between 8 KB and 400 KB, that every game has a how-to-play card, that all five
difficulty tiers are offered where difficulties exist, and that the default settings actually
validate. Adding a game and forgetting one of those wires now fails `npm test` instead of failing
in a stranger's browser.

The feedback box adds 52 of those, split by *what could break*:

- `lib/__tests__/feedback.test.ts` — validation (empty, too short, a review with no rating, a rating on
  an idea, out-of-range stars, the length cap, control characters), that a failed validation stores
  nothing, that a note written with no Supabase is still there afterwards, and that the sixth note in
  an hour is refused on the device.
- `lib/__tests__/feedback-cloud.test.ts` — a fake PostgREST client, **plus assertions that read
  `0003_feedback.sql` itself**: every column the client writes is granted for insert, every column the
  wall reads is granted for select, `contact`/`device_id`/`status` are not readable, RLS is on, the
  rate-limit trigger exists, and there is no update or delete policy. If the client and the migration
  ever disagree, `npm test` fails instead of the wall silently going empty.
- `screens/__tests__/feedback-screen.test.ts` — the page clicked through in jsdom: a review posts and
  is kept, a short note is refused with the field marked `aria-invalid` and nothing stored, a review
  with no stars is refused, and choosing "a game idea" removes the star widget and relabels the button.
- `lib/__tests__/cloud-stats.test.ts` — the cloud career merge takes the better of each field, adds a
  game the device has never played, and survives junk rows instead of writing `NaN` into progress.
- `lib/__tests__/supabase-schema.test.ts` — **the migrations, executed.** It boots PGlite (PostgreSQL
  compiled to WebAssembly, in memory), stubs in the three things Supabase provides — the `anon` and
  `authenticated` roles, `auth.users`, and `auth.uid()` — then runs `0001` → `0002` → `0003` and
  connects **as `anon`** to try everything it must not be able to do: read `contact`, `device_id`,
  `user_id` or `status`; post a review with no rating, or a rating on an idea; claim someone else's
  account; edit or delete a note; read the chat mirror; read anyone's profile. It also proves the
  rate-limit trigger refuses the sixth note in an hour, that a hidden note is hidden but not deleted,
  and that all five tables have RLS on. That is the half of the Supabase story the browser tests
  cannot reach — and the half that matters, because the anon key is public.

The last group is a **real DOM**. `src/games/__tests__/solo-ui.test.ts` runs jsdom, mounts the
actual solo screens inside the actual store and router, and clicks the way a person clicks — then
asserts on what the DOM says afterwards: that Reversi's highlighted squares really flip coins, that
Gomoku places your stone *and* that the AI answers, that a Dots line is reported as drawn, that
Mancala's pits change, and that turning the seat over in Wild Eights raises the pass-and-play
curtain and lifts it again on tap. These are the failures a unit test cannot see — a board that
renders but does nothing, an `onMove` wired to the wrong shape, an AI effect that never fires —
and they were previously only covered by a browser suite you had to remember to run by hand.

The five newer games add 87 of those. The ones worth calling out, because they assert a property
rather than a happy path:

- **Detective Pikachu** generates 450 cases across all five tiers and proves each one has *exactly one*
  consistent answer, that every clue is true of that answer, and that removing any single clue
  makes the case ambiguous — so no clue on the board is filler.
- **Wild Eights** plays 125 complete AI-vs-AI games and asserts the opponent never proposes an
  illegal action, never passes on a playable hand, and that every game terminates. A separate test
  plays 320 games to confirm the expert tier genuinely beats the beginner tier.
- **Spark Quiz** checks 900 generated maths questions for four distinct options and a correct
  answer, and re-derives the arithmetic independently to confirm it.
- **Truth or Dare** proves no card repeats until its pile is exhausted, and that an exhausted pile
  reshuffles instead of dead-ending.

`npm run smoke` (with the relay running) additionally proves: handshake, room creation, join,
ready-up, start, rejection of out-of-turn moves, a full match to a verdict, idempotent replay,
rematch with slot swap, persisted history and a clean leave.

It then runs three more relay suites. `scripts/smoke-cards.ts` and `scripts/smoke-quiz.ts` The first plays a whole hand of online Wild Eights against the
real relay and checks the things only a live server can prove: that each client is sent its own
hand but `-1` for the opponent's and for the stock, that the two visible hands never overlap, and
that the server rejects an out-of-turn move, a card index that does not exist, a card held by the
*other* player, and an action aimed at a stale match. It opens with a **positive control** — a
legal action that must be accepted — because without one, every rejection test would still pass if
the client were simply sending a bad match id, and would prove nothing. That is not hypothetical:
it is exactly the bug that was in the first draft of this script.

`scripts/smoke-quiz.ts` covers the different risk a simultaneous game carries: that one client
could see the other's answer before committing its own. It asserts that when A answers, B's
payload says A is *locked in* but not *what A chose*, that the real answer appears only once the
question closes, that the server rejects a changed answer and an out-of-range option, and that the
server's own clock both closes an unanswered question and starts the next one with nobody acting.

`scripts/smoke-newgames.ts` is the same idea for the four newest games, and it compares the server
against the rulebook step by step rather than just looking for a broadcast: for each of Reversi,
Gomoku, Dots & Boxes and Mancala it creates a room, joins, readies, starts, checks both clients
received byte-identical openings, fires a legal move from the player who is *not* on turn and
requires `illegal_move`, then plays the whole match to a real verdict — asserting after **every**
move that `applyMove(state, actor, move)` computed locally equals the state the relay broadcast.
60 moves of Reversi, 61 of Gomoku, 40 of Dots and a 10-move Mancala finish all pass, and then it
checks a mid-series leave still notifies the player left behind. 32 checks.

`scripts/smoke-online-lifecycle.ts` covers what happens *after* a clean first match, which is where
an online game tends to rot. For both new games it hard-drops the socket mid-match the way a
browser refresh does and checks the board comes back exactly as it was — while still refusing to
show the reconnecting client the opponent's hand or answer — then votes a rematch and checks it
deals a genuinely new game (new match id, different cards, scores back to zero) with the seats
swapped. 25 checks.

### Browser tests

`npm run e2e` drives real Chromium windows against `npm run dev:all`. Several of those suites open
**two** browsers at once — `online-cards.mjs`, `online-quiz.mjs`, `online-sketch.mjs`,
`online-close.mjs` and `online-audio.mjs` — and play a full networked match between them, checking
among other things that one tab's DOM never contains the other player's cards, answer or word. Playwright is an optional dev
dependency; install the browser once with
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npx playwright install chromium`.

* `scripts/e2e/routes.mjs` — loads all 18 routes and asserts every one renders, with **zero console
  errors, zero page errors, zero failed requests and zero broken images**.
* `scripts/e2e/play.mjs` — 18 assertions: tic-tac-toe against the AI, the chess worker answering
  `e4`, the snake world advancing on its own clock, legal-vs-illegal puzzle slides, and then the
  full online slice in two independent browsers — pick a game, create a room, join by invite link,
  ready up, start, play to a server-decided verdict, see the same result on both screens, and
  complete a two-vote rematch.
* `scripts/e2e/online-sketch.mjs` — 31 assertions over a real two-browser Guess & Draw match. It
  reads the word off the drawer's screen, then searches the guesser's entire DOM **and the React
  fibre tree's props** for it, on a whole-word match. It then draws with the mouse and asserts the
  strokes arrive on the other screen *and leave real ink on the canvas* (sampling pixels, not
  counting elements), that undo propagates, that a wrong guess costs nothing, that a correct one
  scores both players with the guesser ahead, and that the roles swap onto a clean canvas for
  round 2. It then plays the whole six-round match out to the result dialog and completes a
  two-vote rematch.
* `scripts/e2e/audio.mjs` — 13 assertions. Patches `AudioContext.prototype.createBufferSource`
  before the app boots and counts `start()` calls on buffers longer than 0.3s, which is the only
  way to tell a real voice clip from an oscillator beep in a headless browser.
* `scripts/e2e/online-audio.mjs` — 8 assertions: a networked match where the key claim is that
  **the opponent hears it too**, not just the player who acted.
* `scripts/e2e/reconnect.mjs` — hard-refreshes a browser mid-match (the board comes back exactly as
  it was), plays on to a verdict, refreshes again **on** the result screen (the server re-sends the
  verdict), and checks the survivor when the opponent leaves.

Fifty real bugs were found and fixed while building this, most of them invisible outside a live
browser:

1. The relay persists match history into `.pikachu-data/`, which sits inside the project — so the
   Vite dev watcher full-reloaded every client the instant a match ended and wiped the result
   screen. `server.watch.ignored` in `vite.config.ts` now excludes it.
2. Reconnecting into a finished match replayed the room and the board but never the verdict, so a
   refresh on the result screen dumped you back in the lobby. The relay now re-sends `finished` on
   resume and on rejoin.
3. Progress mutations ran their side effects *inside* a `setState` updater, which React
   intentionally double-invokes in StrictMode — every achievement toast fired twice. Mutations now
   compute from a synchronous ref and emit effects outside the updater.
4. `fetchpriority` was spelled in HTML case rather than React's `fetchPriority`, so React logged an
   invalid-property warning on every page with key art.
5. The "unbeatable" tic-tac-toe AI *could* be beaten. Its memo table stored alpha-beta **bounds**
   as if they were exact scores, so a value cached during a cutoff came back wrong under a
   different window later. The old test played 30 random games and therefore passed about two runs
   in three — the failure looked like flakiness rather than a defect. The 3×3 search is now exact
   (no cutoffs, memoised on the position), and the test is exhaustive: every opponent reply from
   both seats, 642 terminal lines, zero losses.
6. **Snake Arena started the instant the route loaded.** The snake was already moving before the
   page had finished settling, so it hit the wall in about a second and a half and you lost a run
   you never got to play. Worse, a solo crash was reported as a *draw* — "Dead heat, someone has to
   break the tie" — against a "Personal best" column that was permanently an em-dash. The arena now
   idles until you take the controls (any arrow key or the D-pad), and a solo run is scored against
   a real personal best kept per difficulty in `localStorage`.
7. **Imposter leaked the secret card.** The hold-to-reveal button is replaced by the card while it
   is held, which means the button unmounts and its own `mouseup` never fires — so letting go did
   not hide anything. In a hidden-role game that is the whole premise gone. Release is now handled
   at the window (`mouseup`, `touchend`, `touchcancel`, `keyup`, `blur`, `visibilitychange`), so
   the card hides however you let go of it, including by tabbing away.
8. **Five new views were written against a palette that does not exist.** This theme is inverted —
   `ink-*` are the *light surfaces* and `cream-*` are the *dark text* colours — and the new screens
   used an invented `cocoa-*` scale plus `cream-*` as if it were a background. Tailwind silently
   emits nothing for an unknown token, so the result was dark-on-dark: unreadable quiz answers and
   solid brown blocks where the deduction grid should have been. Caught by screenshotting the
   finished screens rather than by any test, which is exactly why that step is in the loop.

9. **Wild Eights announced the result from one seat's point of view.** The engine wrote its log
   and its closing line as "You went out — 26 points left in your hand", which is correct for
   slot 0 and a lie for slot 1 — and both players receive the same broadcast. The engine now emits
   seat-neutral names (`Volt`/`Spark`) and each surface translates them for whoever is reading, so
   the online board substitutes the two real player names.

10. **Putting a simultaneous game online silently disabled its board.** `isMyTurn()` in `Room.tsx`
    falls through to `state.turn === slot`, and Spark Quiz has no `turn` — a simultaneous game has
    no such thing. `interactive` was therefore false for both players and every answer button
    rendered disabled, with no error logged anywhere. Spark Reflex had already been special-cased;
    the quiz needed the same. The turn pill said "Your move" too, which is meaningless when you
    both move at once — it now reads "Answer now" / "Locked in" / "Answer revealed".
11. **The quiz header read "question 1 of 1".** Redaction truncates the question queue so a client
    cannot read ahead — which also destroyed the only thing the board had to count for progress.
    The redacted payload now carries an explicit `total` next to the truncated queue, and a test
    asserts both halves: that you still cannot see question 2, and that you are told there is one.
12. **Two of the five new games looked broken to the audit and were not.** The 15-game audit
    reported Imposter and Truth or Dare as dead. Both were harness bugs: Imposter opens on a setup
    screen and must be dealt first, Truth or Dare asks you to pick a pile before a card exists, and
    Imposter's reveal button has an `aria-label` ("Hold to reveal the card for Player 1") that
    overrides its visible text, so `getByRole` never matched it. Worth recording because the
    failure mode — a test that reports a working feature as broken — wastes exactly as much time as
    the opposite.
13. **Wild Eights reported a 0–0 result.** `scoreFor()` in `Room.tsx` has a per-game switch with a
    fall-through that reads `state.cells` — which a card game does not have — so the result overlay
    showed both players on zero no matter who won. It now reports hand size, which survives
    redaction because the cards are `-1` but the array length is real. The match HUD had no entry
    for either new game either; both now show their own stats.
14. **The segmented chips were 24.5 px tall.** That scrapes past WCAG 2.5.8 AA by half a pixel and
    is still a poor thumb target on a phone — and this is meant to be played on a phone. Mode,
    difficulty and round-count chips now get a 34–36 px hit area below the `sm` breakpoint and keep
    their compact look above it. Toggles and the Four in a Row column buttons got the same treatment.
15. **The opponent's card fan dropped a stray card onto a second row.** The fan overlaps its cards
    with a negative margin and the container was `flex-wrap`, so on a narrow screen the seventh
    back wrapped and sat on its own, misaligned, looking like a rendering fault. A fan should never
    wrap.
16. **Five games were missing from Solo Adventures.** `SoloHub.tsx` filtered the library against a
    hand-written `SOLO_IDS` array listing the original ten ids, so every game added afterwards was
    invisible there — the page cheerfully announced "10 games" while the library said 15. It now
    derives the list from the registry (`offlineGames()`: anything live with a solo, AI or
    pass-and-play mode), which cannot drift again.
17. **The defeated mascot wore an emoji.** Every other mood badge is a drawn mark — `♥`, `z`, `!`,
    `✦`, CSS dots — but the sweat drop was a 💧 colour-font glyph, which renders differently on
    every platform and sits outside the palette. It is now a small SVG teardrop. A test now fails
    the build if any emoji reappears in the mascot.
18. **3.2 MB of GIF shipped to every visitor for nothing.** The original GIFs sat in `public/`
    alongside the WebP the site actually loads, so they were served but never requested by a single
    line of code. They moved to `art-src/`, outside the served directory, where `scripts/gifs.py`
    still reads them.
19. **Three of the supplied images were never used at all.** Five of the eight PNGs became
    avatars; `image-1`, `image-3` and `image-6` were converted and then simply never referenced —
    and two of them are the best pieces in the set. They are now framed scenes on Library, Profile
    and Achievements. A test now asserts every supplied source file reaches a screen.
20. **444 KB of PNG intermediates were being served.** `public/art/mascot/` held both a `.png` and
    a `.webp` of all five avatars; only the WebP is ever referenced. The PNGs are gone and a test
    fails if they come back.
21. **Two online-quiz checks were racing the network.** They asserted a relay broadcast had
    arrived after a fixed `sleep(1200)`, which holds when the suite runs alone and breaks when it
    runs fifth in a row — a false failure that says nothing about the app. Both now poll for the
    condition with a 10 s ceiling, so they still fail honestly if the broadcast never lands.
    `online-cards` had the same shape before the deal check and got the same treatment.
22. **Spark Quiz hid half the answers on a phone.** On a 390×844 screen the mode rail, AI level,
    round picker, a four-box HUD and the topic chips occupied 740 of 844 px, so options C and D
    rendered below the fold *while the timer ran*. Game settings now collapse behind a disclosure
    below `sm`, the HUD scrolls as one row instead of wrapping to four, and the topics moved in
    with the other settings. Last option now ends at 721 px. This was fixed in `SoloShell`, so all
    nineteen solo games get it.
23. **Volt Runner was rendering in its lowest detail tier on almost every device.**
    `suggestQuality()` returned `performance` for `cores <= 4 || mem <= 4`, which catches most
    laptops and nearly every phone — and `performance` was implemented as *skip the scenery
    entirely*, so the world was a flat gradient with no hills, clouds or trees. The thresholds now
    only catch genuinely weak hardware, and the tier scales the **count** of scenery rather than
    deleting it.
24. **Volt Runner could not be played on a phone at all.** It was keyboard-only — no touch
    handler existed. Swipe left/right changes lane, swipe up or tap jumps, and the canvas no longer
    scrolls the page under your thumb.
25. **`humanSize(0)` reported "1 KB".** An empty music shelf claimed to be using storage.
26. **Our Music was unreachable on desktop.** The header renders `NAV.slice(0, 5)` and the new
    entry was sixth, so it only appeared in the mobile menu.
27. **A nav label broke two test suites.** Both online harnesses scraped the room code out of the
    page with `/\b[A-Z2-9]{5}\b/`. `innerText` returns *rendered* text, and nav labels are
    uppercased by CSS — so "MUSIC" matched first and the guest joined `/room/MUSIC`. The code now
    has a `data-room-code` attribute and the harnesses read that.
28. **Every board piece was a CSS gradient or a hand-written SVG path.** Tic-Tac-Toe, Four in a Row
    and Checkers now use painted tokens — a gold bolt and a rose heart — processed by
    `scripts/pieces.py` and asserted by a test, so a sprite cannot quietly disappear and leave an
    empty cell.
29. **Losing made no sound.** Winning had a Pikachu cry; defeat had only a synth tone. It is now
    the same cry pitched down to 0.68, which reads as a dejected little "pika…" without
    introducing a second character to announce a loss.

30. **The spinning bottle landed 128px off its own table.** Tailwind v4 emits the standalone
    CSS `translate` property for `-translate-x-1/2`, which does *not* merge with an inline
    `transform` — it stacks with it, so the centring was applied twice. The pivot is now set
    entirely in the inline transform and the classes are gone. Worth remembering: any element
    that needs both Tailwind centring *and* a dynamic rotation will hit this.

31. **Truth or Dare renamed nobody.** `createDare` froze the two player names at deal time, so
    typing a name into the field updated the prompt text but not the scoreboard beside it. Added
    `rename()`, which swaps the names without touching the tally or re-dealing the piles.

32. **The Close button on the defeat screen genuinely did nothing** — reported three times, and
    it took three passes to find because the test guarding it was passing for the wrong reason.
    Volt Runner is the only game whose exit button is labelled "Close" and the only one whose
    exit does not reset the match; it ran:

    ```js
    useEffect(() => {
      if (!w.current.over || shown || running) return;
      setShown(true);
      finishMatch({ ... });
    }, [running, shown, best, finishMatch]);   // ← `shown` is a dependency
    ```

    Pressing Close set `shown = false`, which re-ran the effect. The world was still `over`, so
    the guard fell through and `setShown(true)` fired again before the browser painted — the card
    never visibly moved. Worse, `finishMatch` ran again on *every* click, so each attempt to close
    the card banked another play and more XP. The dismissal is now latched in a `settled` ref that
    only `reset()` clears, so the result is offered once and the score banked once.

33. **`close.mjs` passed 30/30 while that bug was live.** All it did was start a game and click
    the header's Library link — it never lost a match, so it never opened a result card. The suite
    now drives Volt Runner to a real crash and asserts the card closes, *stays* closed, does not
    double-count the run, and also responds to Escape. It additionally drives Snake and
    Tic-Tac-Toe to genuine finishes, and a companion suite (`online-close.mjs`) resigns a real
    online match and walks the stacked card → confirm → leave path that all nine online games
    share. Both fixes were verified by reinstating the broken line, watching the suite fail, then
    restoring the fix and watching it pass.

34. **The result dialog ignored Escape.** It declares `role="dialog" aria-modal="true"` but had no
    key handler, so a keyboard user had no way out of a defeat card beyond tabbing to a button.
    Escape now calls the same exit action, and Volt Runner stops swallowing keys while the card is
    up (otherwise one Escape both closed the card and toggled pause).

35. **Face-down memory cards told screen readers what they were.** The painted face is on the back
    of a 3D card, so it sits in the DOM while the card is down — the button's label said "Card 4,
    face down" while its own text content said "VOLT BERRY". The face is now `aria-hidden`; the
    button's label remains the single source of truth.

36. **The Escape fix in #34 broke Escape in online rooms.** Caught the turn after shipping it.
    Online, the result card's exit does not reset anything — it opens a "Leave this arena?"
    confirm *on top of* the card. `ConfirmDialog` listens on `document` in the bubble phase;
    the new handler listened on `window` in the **capture** phase and called `stopPropagation()`,
    so it ate the key before the confirm ever saw it. The confirm could be opened with Escape and
    then never dismissed with it. The result card now stands down whenever any other
    `[role="dialog"]` is in the document:

    ```js
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    if (dialogs.some((d) => d !== rootRef.current)) return;  // something is on top of us
    ```

    The general lesson: a global key handler added for one dialog becomes every other dialog's
    problem. Capture phase plus `stopPropagation` makes it everyone's problem first.

37. **The endless runner opened at midnight, every single run.** The day/night term was
    `w.night > 1 ? (w.night - 1) * 2.2 : 1 - w.night * 2.2`, and at distance zero that second
    branch evaluates to `1 - 0`, i.e. full night. Every run started in the dark and brightened
    into day, which is backwards. Replaced with a raised cosine over a 0→2 cycle so 0 and 2 are
    noon, 1 is midnight, and dusk eases rather than snapping between two hard-coded palettes:

    ```js
    const night = (1 - Math.cos(Math.PI * w.night)) / 2;
    ```

38. **The runner's obstacle gaps were mathematically unclearable.** The minimum spawn gap was
    `speed * AIR_TIME * 1.15`. A jump commits you for `AIR_TIME` (0.649s) and has to be *started*
    ~0.33s before the obstacle arrives, so with a gap of `AIR_TIME * 1.15` you land 0.325s after
    obstacle A and obstacle B already needed its jump 0.09s ago. Proven by a bot that plays
    in-page on `requestAnimationFrame`: it jumped with a perfect lead, cleared A, and died
    mid-descent on B every time. Gaps are now measured in **seconds** — a full airtime plus a real
    reaction buffer — and the spacing barely tightens as the run speeds up:

    ```js
    const minSec = AIR_TIME + 0.46 - ramp * 0.11;   // 1.11s → 1.00s
    ```

    The first version of that bot ran over CDP from node, one `page.evaluate` per decision. It
    added ~250ms of latency and made a *fair* game look unwinnable. If a bot has to judge
    milliseconds, it has to live in the page.

39. **You could sail through two thirds of a visible obstacle.** The hay-bale sprite is 450×200.
    Drawn at `h = 58` it covered ~130 virtual px of road, but its hitbox was a hand-typed
    `w: 42`. Every obstacle had the same problem in miniature — the widths were tuned by eye and
    the renderer re-derived its own width from `naturalWidth / naturalHeight`. There is now one
    `OB_SPEC` table holding each sprite's real aspect ratio, the hitbox width is computed from it,
    and the renderer blits at exactly the hitbox size. `src/games/__tests__/arcade.test.ts` parses
    the PNG/WebP headers on disk and fails if a re-export ever drifts from the table — plus it
    solves the jump arc analytically to assert every obstacle is clearable with timing slack to
    spare, that a duck slips under a low flyer and standing does not, and that a charge can only
    be taken in mid-air.

40. **The runner gave a phone a third of the reaction time it gave a desktop.** The canvas scaled
    the virtual field to fit on *height*, so the visible road was `canvasWidth / scale` — about
    800 virtual px on a laptop and about 340 on a 390px phone. Same obstacle, same speed, a third
    of the warning. It now fits on **width** with the ground anchored to the bottom edge, and the
    canvas carries a fixed `aspectRatio`, so every screen sees exactly `VW` of road. Two smaller
    things fell out of the same pass: the scenery was gated behind `lod > 0.5`, so the Performance
    quality tier silently deleted the hills and read as missing art rather than a cheaper frame
    (a few quadratic curves cost nothing — they are always drawn now); and the HUD is a no-wrap
    scroll strip on mobile, so Distance and Speed now yield below `sm` instead of pushing *Best*
    — the entire point of a high-score game — off the edge of the screen.

    Two art bugs showed up only once the camera was right. The four-frame run sheet carried a
    ~15px watermark remnant at the bottom-right of every frame; since the sprite is aligned by its
    *bottom* edge, that litter was what sat on the ground line and Pikachu floated above it. And
    the charge pickup had a painted ground shadow baked in, which looked fine on a shelf and
    absurd on a collectible that hovers at head height. Both are removed by connected-component
    analysis — keep the big blob, drop anything under 100px — rather than by a bounding-box crop,
    which cannot tell litter from subject.

41. **Every Play Together match was nearly silent.** Sound had been written into the *solo* views,
    but a room renders the shared board components — and four of them (`TicTacToeBoard`,
    `ConnectFourBoard`, `SparkQuizBoard`, `WildEightsBoard`) contained no `sfx()` call at all.
    Playing online with another person, the thing this whole site exists for, was the quietest way
    to use it. Fixing it inside ten board files would have meant double-firing wherever a solo view
    already emitted the same cue, so instead `src/lib/matchCues.ts` diffs successive match states in
    the one place that sees all nine games — `Room.tsx`. It reads defensively, because the relay
    redacts hidden information and a field may be absent or a different shape than the solo state.
    `scripts/e2e/online-audio.mjs` drives two real browsers through a server-refereed match and
    counts decoded cries on **both** sides; with the hook commented out it reports `0 cries on host,
    0 cries on guest`, which is exactly the silence that was shipped.

42. **Four games had no sound of their own, and the biggest cue of all was a beep.** Spark Reflex
    never called `sfx` once — it did not even destructure it — so everything after the signal was
    mute. Snake's crash was silent: you simply stopped and the result card appeared. Both are now
    voiced, and Snake's three pickups (worth 10, 25 and 40) get three different voices off the score
    delta instead of one generic blip. Separately, only 9 of 37 cues had a real cry; the rest were
    oscillator beeps, including `move`, `place`, `drop`, `hit`, `miss` and `capture` — the cues that
    actually fire while you are playing. That is now 24.

    The failure mode that hid all of this: a cry that fails to load **does not throw**. `playCry`
    caches the failure and falls back to the synth forever, which is correct at runtime and
    invisible to a typo. `src/lib/__tests__/audio.test.ts` now reads `audio.ts` and the real
    directory, and fails on a missing file, an unused file, a load-bearing cue that lost its voice,
    or a UI cue that gained one.

43. **Every downloaded clip started with dead air, so the arcade sounded laggy rather than loud.**
    The twelve raw rips opened with 0.1–0.5s of silence. The cue fired on the exact frame you
    jumped — the code was right — but the voice arrived a third of a second later, which reads as
    input lag, not as audio. Trimming at a real amplitude threshold (not a fixed offset, the
    lead-ins differed) is what made the cues feel attached to the action.

44. **Loudness was random between cues.** Peaks across the set ran from 0.16 to 0.60, close to
    12 dB of spread, so during one run of Volt Runner a pickup could be inaudible and the next
    jump startling. Every clip is now peak-normalised to −1 dBFS, with per-cue `gain` left to do
    only deliberate mixing rather than compensating for the source files.
45. **A phone spent 420 px of a 727 px screen on chrome before any game.** The sticky header (63 px),
    a game bar that wrapped to two rows under it (105 px), the settings disclosure and a full-size
    HUD panel stacked up before the board began. Volt Runner's canvas landed at y=337 as a 365×129
    letterbox slit — 16.5 % of the screen — with its Jump and Duck buttons at y≈1330, off-screen,
    so the only controls were ones you had to scroll away from the game to reach. The game bar is
    now one 44 px row that scrolls away below `sm`, the room bar the same (116 px → 44 px), `Stat`
    and the HUD panels are compact on small screens, and the mascot shrinks. Permanent chrome is
    **63 px**, the canvas is **354×274 at y=249**, and the whole screen fits with no scrolling.
    `mobile.mjs` now fails the build if sticky chrome exceeds 150 px.
46. **Snake told phone players to press keys they do not have.** The start card read "Press an arrow
    key to start the run" over "SPACE PAUSES · ESC HOLDS" — on a touch device with a D-pad sitting
    below the fold. It reads as a broken game, not a wrong label. Volt Runner's canvas overlay said
    "Press space, or tap, to run / Space ↑ jumps · ↓ ducks" and Spark Reflex said "Click or press
    space". All of it now branches on `useTouch()`.
47. **Making Pikachu bigger on a phone looked impossible without making the game unfair.** The
    renderer fits on width, so a taller canvas only adds sky, and cropping the road to zoom in
    steals reaction time — the exact bug fixed in #40. The way out is to compensate rather than
    crop: show `VW/m` of road, scale speed by `(road − px)/(VW − PLAYER_X)` so the time from an
    obstacle appearing to reaching you is unchanged, and divide gravity by `m` so airtime grows in
    step and a jump still spans an obstacle that is now relatively wider. At m=1.7 the phone keeps
    a **1.79 s** warning at standard pace, exactly as the desktop does, while Pikachu goes from
    28 px to 50 px and the canvas from 47 k to 97 k pixels. Desktop is untouched (m=1).
48. **The zoom quietly made every charge uncollectable, and only a bot caught it.** Obstacle heights
    are absolute because they are judged against the player's body, but the jump apex scales with
    the zoom — so charges pinned at 70–100 sat far below a 237-unit arc and a phone player sailed
    clean over all of them. They now float in a band around the apex, offset by the sprite's own
    height, because at the top of the arc the body occupies `[y, y+64]` and a charge level with the
    apex is already under its feet. At m=1 the band is 94–134, so desktop play is unchanged.
    Found by running the in-page bot at phone size: 0 charges in 55 s, now 4–5.
49. **The bottom quarter of every Guess & Draw drawing was being thrown away.** Points are stored in
    a square 0..1000 space, normalised on input by the canvas's width *and* height, but rendered
    with both axes scaled by the width. On a 4:3 canvas everything below y≈750 was drawn past the
    bottom edge: a stroke along the bottom rendered nowhere at all. Fixed with per-axis scaling,
    which also means the picture lands in the same relative place if the two players' canvases are
    different shapes. `online-sketch.mjs` now draws along the bottom edge and counts the ink.
50. **Collapsing a button's label collapsed its tap target, then its name.** Hiding the "Library"
    and "Restart" text below `sm` left 30–31 px icon buttons, under the 32 px floor — caught by the
    phone audit the same minute it was introduced; `.btn-iconish` holds them at 36×36 until the
    label returns. The second half was worse and needed a different test to find: with the span
    hidden, those buttons had **no accessible name at all** on a phone, invisible to a size audit
    but obvious to `close.mjs`, which navigates by role and name the way a screen reader does. They
    carry explicit `aria-label`s now. Two regressions from one three-word change, each found by a
    different suite.
51. **The chess board was the last board still drawn with hand-written SVG paths.** Every other
    board had moved to painted artwork; the chess set was a `PATHS` map of six hand-plotted
    `d` strings, which is why it looked like clip art beside the painted checkers coins. The
    pieces are now real transparent SVGs in `public/art/chess` (the same Staunty set lichess
    uses), so `<ChessPiece>` is one `<img>` and the twelve files cache once per session. Sizing
    moved from a fixed 78% to 88% of the square, legal-move dots and capture rings now sit above
    the piece instead of behind it, a checked king gets a red bloom under the artwork, and the
    promotion chooser and captured-material strip use the same source, so nothing can drift out
    of sync. Attribution and licence live next to the files.
52. **The dedication under the home page is gone.** "Made For Julian" and its paragraph were
    removed at the owner's request; the closing illustration (the divider plus the two mascots)
    stays, so the page still ends on a picture rather than on the game grid.
53. **The chat looked like a different app.** It used its own hexes (`#fffefb`, `#fffcf5`), its own
    shadow depths (`shadow-xs`/`shadow-2xl`), 9.5px labels and eight OS emoji, while every other
    surface is on the `--line` / panel / `.eyebrow` system. It was also *two* implementations —
    a 490px floating modal during play and a different inline panel in the lobby — so any fix had
    to be made twice. Both are gone: `ChatRail` and `MobileChat` now render the same
    `ChatSurface`, the styling uses only existing tokens, and reactions are drawn stickers.
54. **The chat's accessibility was accidental.** The send button was a 32px icon with no
    accessible name at all, new messages were never announced (no `role="log"`, no live region),
    the input had no label, and the phone sheet was a `fixed` panel that covered the bottom third
    of the board with no way out but tapping the same button. Now: labelled input and 44px send
    button, `role="log" aria-live="polite"` on the log, a separate polite region that announces
    "Julian is typing", Escape closes the sheet and returns focus to the launcher, Tab is trapped
    while it is open, and the scroll position is only forced when the reader is already at the
    bottom (with a "Newest" affordance otherwise). Verified by 18 jsdom interaction assertions
    covering Enter, Shift+Enter, reaction chips, whitespace-only sends and Escape.
55. **The relay had no way to say "still here".** Typing presence needed a message the protocol
    did not have, and the tempting shortcut — reusing `chat` with empty text — would have created
    phantom bubbles in the log on the other side. A dedicated `typing` event now goes to the
    opponent only, is coalesced client-side to one event per ~1.5s and self-heals with an `off`
    after 2.6s of silence, so a closed tab cannot leave "is typing" stuck on screen.
56. **The catalogue and the code could drift apart silently.** Nothing stopped a game being added to
    the registry as online while the relay had no referee for it, or a `SoloView` being deleted while
    its route stayed, or an `artKey` pointing at a file that was never exported. The game list lived in
    four places — the server's `RULES`, `Solo.tsx`'s lazy map, `Room.tsx`'s board map and
    `GameArtwork`'s key table — and each one was updated by hand. All four are now single tables
    (`src/games/referees.ts`, `src/games/views.ts`, `src/components/boards/registry.tsx`,
    `src/components/artManifest.ts`) imported by both the code that ships and the code that tests it,
    and `catalog.test.ts` asserts every cross-reference between them: ids, slugs, referees, boards,
    solo views (and orphan views), art files on disk, rules cards, difficulty tiers and default
    settings.
57. **Handing the device over exposed the next player's hand.** On Wild Eights played on one device
    the seat changed the instant a turn ended, so the person you just passed the phone to could see your
    cards before you had let go of it. A change of seat now raises an opaque curtain over the whole
    board — hand, table and log — naming the player whose turn it is, and it only lifts when that
    player taps "deal me in".
58. **The in-room turn indicator was a colour.** "Your move" versus "their move" was gold versus
    cream, which is invisible to a screen reader and easy to miss for ~8% of men. The pill is now a
    `role="status"` polite live region, so the change is announced, and the dot inside it is
    `aria-hidden` so the state is not read twice.


59. **There was nowhere to say anything.** Twenty games and no way to tell the person who built them
    that a board was unreadable on a phone, or that a game was missing. `/feedback` now takes a
    review, a game idea, an improvement and a bug report; a note is written to the device before it
    is sent, so a missing Supabase project or a closed tab cannot lose it, and published reviews are
    shown on the page. The database side is not an afterthought: column-level grants, CHECK
    constraints, a `security definer` rate-limit trigger and no update/delete policy at all.
60. **Supabase shipped two tables you could read and write at will, and stats that never came back.**
    `room_messages` had `using (true)` on select and `with check (true)` on insert — with a public
    anon key that is every room's chat, readable, and a spam target. It is now append-only with no
    select grant, length checks on every column, and a comment pointing at the prune query. Separately,
    signing in on a second device restored the name and mascot but left the career at zero because the
    stats `fetchRemoteUserData()` returned were thrown away; they are now merged field by field with
    `max`, on sign-in and on boot.

---

## The artwork you supplied

Seven GIFs were handed to this project and **all seven are on the screen**. `scripts/gifs.py` is
the whole pipeline: crop off the source watermark, knock the flat background out with a border-seeded
flood fill (a neighbour-tolerance fill tears anti-aliased pixel art apart), re-encode as animated
WebP. 3.2 MB of GIF becomes 768 KB of WebP with real alpha, and the originals stay in `art-src/`
rather than `public/`, so they are never served.

| source | clip | where it plays |
|---|---|---|
| `44-pikachu-pixel` | `run.webp` | the `competitive` mood — Pikachu bounding along |
| `60-pikachu` | `shy.webp` | `idle`, `defeated`, `sleeping` — including the home hero |
| `61-pikachu-game` | `hello.webp` | `excited`, `victory` |
| `70-pikachu-pixel` | `cap.webp` | `thinking`, `waiting`, `error` — the finished frames only |
| `70-pikachu-pixel` | `materialise.webp` | `loading` — the full 59-frame sketch → ink → colour arc |
| `74-pikachu-christmas` | `gift.webp` | framed scene, Challenges |
| `75-pikachu` | `crowd.webp` | framed scene, Play Together |
| `78-pikachu` | `curious.webp` | framed scene, Solo Adventures |

Eight PNGs came with them, and all eight are used too. Five became the avatars you can pick on
your trainer card; the other three are painted scenes rather than cut-outs, so they go through the
same frame (`scripts/scenes.py`):

| source | becomes | where |
|---|---|---|
| `image-2`, `image-4`, `image-5`, `image-7`, `image-8` | the five pickable avatars | Profile → Your card |
| `image-1` | `meadow.webp` | Game Library header |
| `image-3` | `goldenhour.webp` | Profile, beside the trainer card |
| `image-6` | `storm.webp` | Achievements — the one image with real competitive bite |

The two clips cut from the same source are genuinely different: `cap` takes the finished frames
from 53 on, `materialise` walks the entire draw-in from the first pale pencil line to full colour,
which is why it is the loading state.

Five clips are cut-outs that float freely in the layout. The other three keep their original
painted backdrop, because a reliable knockout of a full anime background is not possible and a bad
one looks far worse than an honest frame — so they are presented as **matted keepsakes** instead:
cream paper mount, warm colour grade and a soft inner vignette to pull the saturated anime palette
back towards the page, and a taped corner. They read as something kept rather than something
pasted in.

### Painted game art

Nothing in a game is drawn with CSS any more. Board pieces, the Volt Runner sprites, the Memory
Match card faces and the Truth or Dare bottle are all painted artwork, generated to one brief
(thick dark-brown outline, flat cel shading, the warm house palette) so the set looks like it came
from one hand. `scripts/memcards.py` and `scripts/pieces.py` do the same three things to each:
knock out the white field with a **border-seeded flood fill** (a global "is this pixel white?"
test also erases the white *inside* the subject — the glint on the glass, the highlight on a
berry), crop to the subject, then pad onto a square canvas so every sprite centres identically on
its tile and the bottle rotates around its own middle.

| set | files | where |
|---|---|---|
| board pieces | `art/piece/*.webp` ×4 | Tic-Tac-Toe, Four in a Row, Checkers |
| runner | `art/run/*` ×5 | Volt Runner |
| pairs faces | `art/mem/*.webp` | Pika Pairs |
| bottle | `art/dare/bottle.webp` | Truth or Dare |
| game covers | `art/game/*.webp` ×20 | Library, Home, room picker |

Every cover is listed in `src/components/artManifest.ts` — one table, keyed by the `artKey` in the
registry, with a fallback for keys that have no painting yet. `GameArtwork.tsx` renders from it and
`catalog.test.ts` fails if a key is missing from the manifest or points at a file that is absent,
empty or absurdly large. The four newest covers (Reversi's lanterns, Gomoku's river stones, the
pencil-drawn Dots grid, the carved Mancala board) were painted to the same brief as the rest and
encoded to 640×640 WebP from a 1024 px master kept in `art-src/game/` — outside
`public/`, because masters are working files and every deployed byte should be art the
site actually serves.

The Memory Match set is **all 18 painted**. `PAINTED_CARDS` in `MemoryBoard.tsx` is the single
source of truth: an id in that set renders its painted face, anything else falls back to the
original vector glyph, so the board can never be broken or half-empty mid-set. Every board size
is now fully painted — a 6×6 shows 36 painted faces and 0 leftover glyphs. Two tests guard this
in both directions: art listed but missing on disk fails, and art sitting on disk that was never
switched on fails too.

The bottle is a real spin, not a looping GIF: the landing slot is chosen *before* the spin and the
CSS transform is built to finish there, so the neck can never disagree with the name it lands on
(verified over 20 consecutive spins). Under `prefers-reduced-motion` it resolves in 420 ms with no
whirling.

`src/mascot/__tests__/clips.test.ts` holds all fifteen source files together. It fails if a source GIF stops being
converted, if a clip file goes missing or shrinks to nothing, if a WebP loses its `ANMF` chunk and
silently becomes a still, if a clip is never referenced, if any of the ten moods loses its entry,
if the raw GIFs reappear in `public/`, or if an emoji creeps back in as a substitute for the
artwork.

---

## Credits

Game design, engines, interface, layout, typography, boards, icons and the synthesised sound layer
are original to this project. The chess piece artwork in `public/art/chess` is the **Staunty** set
by **sadsnake1** (CC BY-NC-SA 4.0), taken unmodified from the lichess repository — see
`public/art/chess/CREDITS.md`. It is used here under the non-commercial clause, which this personal
project satisfies. Mascot clips are cleaned and re-encoded from supplied source GIFs;
character cries are the public Pokémon Showdown cry files. Runtime dependencies are React, React
Router, `chess.js` (move legality), `ws` (relay) and the optional Supabase client.

**The tip jar.** Everything here is free and there is no paid tier, so the only support link in the
app is a plain anchor — \`<a href="https://buymeacoffee.com/razalpa" target="_blank" rel="noopener
noreferrer">\` — rendered by \`src/components/Support.tsx\` in exactly two places: a quiet card at the
bottom of the home page, and the desktop footer. It never floats over a board, it never interrupts a
match, and it is a real link so middle-click, copy-link and screen readers all behave normally.

Pikachu is a trademark of Nintendo / Creatures Inc. / GAME FREAK. This is a personal,
non-commercial project and is not affiliated with or endorsed by them.
