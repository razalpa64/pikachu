# Game audit — design, UI, UX and logic

A pass over the 20 games that existed at the time, checking four things per game:
does the **referee** obey its own contract, is the **board** readable and tappable,
does the **screen** tell you what is happening, and does the **flow** lead anywhere
sensible when the match ends. Everything listed as *fixed* is in this branch;
everything listed under *not changed* is a deliberate decision, not an oversight.

> The six games added since have their own section at the end — see
> **Addendum: the party shelf**. The numbers in this opening section are the ones
> that pass actually reported and are left as they were.

Verification: `npm run build`, `npx vitest run` → **419 tests / 22 files**, `npx
oxlint src server` → 0 errors. Two new suites were added (see the end).

---

## Systemic fixes (apply to every game)

| Flaw | What was wrong | Fix |
| --- | --- | --- |
| `legalMoves(state, p)` ignored `p` in chess, Drop Four and Tic-Tac-Toe | Asking for the *idle* seat returned the player-on-turn's moves. Any UI that enumerates both seats lit up the opponent's options as if they were yours. | Every referee now returns `[]` for a seat that is not on turn. Locked by the new invariant suite. |
| `applyMove` trusted its input in 8 referees | chess.js throws on an unparseable move, Drop Four wrote to `board[-7]` on a full column, Memory accepted `resolve` with fewer than two cards up (producing `owner[undefined]`), Checkers dereferenced `board[m.from]!`. One malformed message, or one stale closure, was a dead room. | All referees are guarded by `isLegal` at the top of `applyMove` and return the state unchanged. |
| Result dialog offered two buttons that did the same thing | Solo screens passed the same `reset` as both `onRematch` and `onExit`, so a finished match showed "New game" *and* "Reset board", neither of which left the table. | `ResultOverlay` detects the duplicate and turns the second action into **Library**. Escape follows the same path. Online rooms are unaffected (their two handlers genuinely differ). |
| 47 stat numbers were below 4.5:1 | Gold `#f0b429` at **1.8:1**, sky `#4a9fd8` at **2.9:1**, mint `#3fae82` at **2.7:1** — the HUD numbers were the least legible text on the page. | Replaced with darker accents of the same hue (`#8d5a05`, `#1f6699`, `#17795a`, …), all ≥ 4.8:1 on paper and ≥ 5.0:1 on the chips they sit in. |
| Dialog copy was invisible or marginal | The "Drawn" heading was painted `#F7F1DF` — **1.1:1** on the panel. "Defeated" was 2.9:1, "Victory"'s eyebrow 1.8:1. | Separate `ink` value per verdict, all ≥ 4.5:1; the tint colour is now used only for the glow. |
| Turn pill failed AA | `bg-spark-400` with cocoa ink = **3.85:1** at 10.5px. | `bg-blush-300` (5.9:1) — same pink, legible. |
| Game commentary was invisible to screen readers | The mascot sentence is where a game says "chain jump available", "check", "your turn". It was a plain paragraph. | `role="status"` on the line, so state changes are announced. |

---

## Per game

**Chess Arena** — `legalMoves` seat leak; `applyMove` unguarded (a null move threw
inside chess.js); **Resign always conceded for White** and the confirm still said
"The engine takes the point" in same-device play — now the side on move concedes
and the wording matches the mode; the scoreboard row printed the end reason
("checkmate") in a numeric column; the clock's turn accent was 1.9:1; the
promotion chooser had no focus target, no Escape, no `aria-modal`, and announced
"Promote to q/r/b/n" — now "queen/rook/bishop/knight"; square labels now say
*in check* / *selected*.

**Tic-Tac-Toe Duel** — seat leak; unguarded `applyMove`; the result dialog printed
the same draw count in both columns; pink turn pill.

**Drop Four** — seat leak; unguarded `applyMove`; **drop slots sat 13px to the
left of their columns** (the board's `p-2.5` + 3px border was never matched on the
drop row); the best-of-3 series never concluded — "Rematch" kept accumulating
wins for ever. Rematch now reads "Next round" until a side has clinched, then
"New series".

**Memory Match** — the resolve path could corrupt ownership when fewer than two
cards were up; unguarded `applyMove`; pink turn pill. (The existing face-down a11y
work — labels hidden behind the card flip — was already correct.)

**Checkers Royale** — unguarded `applyMove`; HUD accents.

**Battleship** — during deployment the room offered *no enumerable action* at all
(`legalMoves` returned `[]` for both seats until a fleet existed), and it kept
returning `ready` after you had already pressed it. `ready` is now offered
exactly once. Every one of the 100 radar squares announced only its coordinate;
they now say *not fired yet / hit / hit, ship sunk / miss*, and your own waters
say *your ship / sunk / enemy missed here*. `applyMove` guarded.

**Reaction Duel** — the pad's accessible name said "Wait for the signal" even
while it displayed the round result, and the score pips rendered as near-black
bars on cream. Both fixed; HUD accent.

**Wild Eights** — unguarded `applyMove` (the other card paths were already
validated). Hand-over curtain and hidden-hand redaction were already right.

**Reversi** — the last-move ring was `#ffd24d` on mint (**1.4:1**), i.e. invisible;
a dashed ghost was painted on *every* empty square at 25% opacity, so a legal move
looked like decoration. Now: cocoa ring for the last move, ghosts only on squares
that actually flip something, and with hints on, the ghost shows *how many* discs
it turns.

**Gomoku** — no board defect found (last-stone mark, star points, score chips and
grid semantics all present). Benefits from the shared overlay/live-region fixes.

**Dots & Boxes** — the lines were **~6–10px tall tap targets** on a phone. The hit
box is padded to ≈26px with a cancelling negative margin, so the lattice geometry
is unchanged. Row/column semantics were already correct.

**Mancala** — two result buttons that did the same thing (now Rematch keeps the
series, the second action leaves for the library); HUD accents.

**Spark Quiz (trivia, online + solo)** — `applyMove` crashed on a malformed
move; the reveal feedback and the "locked in / waiting" line are now live
regions; your locked answer exposes `aria-pressed` instead of relying on colour.

**Guess & Draw (Sketch & Guess)** — excluded from the referee contract by design
(free-form input, no turn owner). The board itself was rebuilt after three
player-visible faults were reproduced in a browser (two players, headless
Chromium, drawn with a mouse and with touch):

1. **Lines blinked out while you drew them.** A long stroke is flushed to the
   server mid-draw so the other screen keeps up; the local copy was dropped at
   that moment and only came back when the echo arrived. Sent-but-not-echoed
   strokes are now kept in a `pending` layer and dropped exactly as the echo
   lands (`reconcilePending`).
2. **The canvas got slower the more you drew.** Every pointer sample repainted
   the whole history. Committed strokes are now rendered once into an offscreen
   bitmap keyed by `strokeCacheKey`; a sample costs one blit plus the stroke
   under the finger.
3. **A palm or a second finger drew.** One primary pointer owns a stroke; the
   stroke ends on pointer-up (not pointer-leave) and is thrown away if the
   browser cancels it. Taps leave a dot instead of nothing.

On a phone the tools are 36 px or more tall, the palette scrolls instead of
wrapping, and the canvas is scrolled clear of the room's sticky bar so no part of
the picture is hidden. `src/games/__tests__/sketch-board.test.ts` (16 cases)
drives real DOM events through the board; `src/games/__tests__/sketch-strokes.test.ts`
(23 cases) covers the arithmetic; `scripts/e2e/online-sketch.mjs` (31 checks) and
`tools/verify/sketch7.mjs` (16 checks, CDP touch) prove it end to end.

**Detective Pikachu** — generated cases are still brute-force checked for a
unique solution before they are shown (existing guarantee); the duplicate result
action is gone.

**Imposter** — "You are the imposter" and the crew/imposter headings were 2.9:1.

**Dare Deck** — challenge counter accent was 2.9:1.

**Snake** — canvas, keyboard, swipe pad, pause and the "standing by until you
steer" guard were all sound; result action de-duplicated.

**Puzzle Chambers** — chamber-name stat accent; the two result actions already
differed (next puzzle / switch chamber) and were left alone.

**Volt Runner (arcade)** — the canvas already documents its controls in its
accessible name; "Close" on the result dialog is intentionally *not* "Library".

---

## Not changed, on purpose

- No rule variants, board sizes, difficulty curves or content were altered.
- Simultaneous phases (Battleship deployment, Reaction, Sketch, Spark Quiz) still
  report `currentPlayer: null` — that is correct for "both seats may act", and the
  room's own `mayAct()` already handles it. Only the *unenumerable* action was a
  real gap.
- No layout redesigns: the alignment, contrast and hit-area changes are local.

## New tests

- `src/games/__tests__/referee-invariants.test.ts` — plays every turn-based
  referee thousands of random moves deep against the contract: no input
  mutation (state is deep-frozen), `applyMove` must not crash or change anything
  on an illegal move, the idle seat is never offered a move, a finished game
  offers none, and a room with nothing to do must have a timer. 48 checks across
  12 referees.
- `src/lib/__tests__/contrast.test.ts` — computes WCAG ratios from the real hex
  values: every `Stat` accent, the three result-verdict inks, and the turn pill.
- `src/games/__tests__/solo-ui.test.ts` — Drop Four and Tic-Tac-Toe added to the
  click-through suite (a click must reach the referee and the AI must answer).

## Known limits

"It renders and responds" below is proven in jsdom and by build, not by
screenshot. The contrast numbers are computed, the hit areas are computed from
the CSS, and the referee behaviour is executed — but a final eyeball on a real
phone is still worth doing. (A headless browser was later wired up for the DOS
shelf — see `docs/pikachu-arcade.md` — and that pass found real bugs the jsdom
tests could not; the same treatment has not yet been given to these screens.)

---

## Addendum: the party shelf

Six games were added after the audit above: **Would You Rather**, **Word Bomb**,
**Daily Puzzle**, **Berry Catch**, **Bluff Trivia** and **Spyfall**. They are
checked against the same four questions, and the answers are worth writing down
because three of them fail in ways the older games could not.

| Game | Referee | Board | Screen | Flow |
| --- | --- | --- | --- | --- |
| Would You Rather | Server-refereed, deadline-driven; both answers are withheld until both are in or the window closes | Two large choice cards, tap targets ≥ 44 px, no third option | Says who is answering and who is betting, and never labels the answer before the reveal | Reveals both picks with the dilemma, then swaps roles |
| Word Bomb | Server clock owns the fuse; a repeat, a wrong letter or a timeout is a strike | A lit letter, a burning fuse, and a real text field | Says whose turn it is, what letter is live, and how many strikes are left | Two strikes ends it with the word that was not found |
| Daily Puzzle | None (solo, generated from the date) | 5×5 nonogram with row/column counts on both axes | Says which puzzle today is, and that the grid is the same for everyone | Ends on a share line that gives away no cells |
| Berry Catch | None (solo canvas) | Full-bleed field, basket follows pointer and keys | Lives, score and streak are separate readouts, and the streak multiplier says what it will pay | Ends with score and best |
| Bluff Trivia | Server-refereed; writing and voting each have a deadline, and the relay ticks them | Three ballot buttons, each labelled with its owner only once the vote is over | Never names the truth while the ballot is open; your own lie is disabled and marked | Reveal shows who wrote what, plus points per author |
| Spyfall | Pure and seeded in `round.ts`; the screen only renders it | One card at a time behind a curtain, then a secret ballot | Says which player's card or vote is on screen, and never carries the last card forward | Tally, the spy's one guess, then a scorecard for every seat |

Things that were deliberately **not** done:

- **Spyfall and Imposter are local-only.** Both need 3–8 seats; a room seats two.
  They say so where you pick them rather than pretending a two-player version is
  the game.
- **Guess & Draw is online-only.** Drawing needs a canvas on the drawer's device
  and a text box on the guesser's; the state is a server-owned stroke list, so
  there is no honest single-device version.
- **No decorative animation was added to any of the six.** The only motion is the
  berry falling, the fuse burning and the card curtain, and `prefers-reduced-motion`
  removes all three.

Test coverage at the time of writing: **567 tests across 38 files**, including
`spyfall.test.ts` (19), `spyfall-ui.test.ts` (7), `bluff.test.ts` (16),
`bluff-ui.test.ts` (6), `berry.test.ts` (11), `berry-ui.test.ts` (3) and
`shelf.test.ts` (4) — the last one names the ten requested games and fails if any
of them loses its cover, its rules card or the screen that plays it.

---

## Addendum: Ludo Royale, the art and input pass

Ludo shipped with a procedural board — gradients doing the work of lacquer and
wood — and it looked like it. It also had bugs that no amount of art would have
fixed, and the second pass found five:

| Flaw | What was wrong | Fix |
| --- | --- | --- |
| **The game could dead-end, permanently** | `SoloView` asked the referee for seat 0's moves on every turn. `legalMoves(state, 0)` is `[]` when seat 1 is to move, and `[].every(...)` is `true`, so the screen offered *"Nothing to move — pass"* while four tokens were plainly movable. Pressing it did nothing (the referee refused the pass) and the game stopped for good. | The acting seat is derived first (`mode === 'local' ? state.turn : 0`) and every legality question is asked about *that* seat. A legal list is never read as "nothing to move" unless it is non-empty. |
| **The die always showed one pip** | Pips were placed on a 3×3 grid, whose cell centres are at 0.167 / 0.5 / 0.833. Every pip coordinate (0.28, 0.72, …) missed, so a 6 rendered as a single dot — the player was told the number only by the text. | Pips are placed by fraction of the face, and the count is now checked per face in the browser (`data-die-face` vs the number of rendered pips). |
| **A token looked like it was on the wrong square** | A piece's foot was drawn at the bottom edge of its cell, so a token on row 8 stood visually on row 7 — which is the row somebody's home lane occupies. | The foot sits low in its own cell and the body overlaps the row above, the way a chess piece does. |
| **The same vacuous-pass bug in the online room** | `legalMoves(...).every(m => m.t === 'pass')` on an empty list is `true`. | Guarded by `legal.length > 0`. |
| **The hint told you to tap a token that did not exist** | "You rolled 5. Tap a glowing token." appeared even when nothing could move. | The hint has three cases now: tap, nothing-can-use-it, and waiting. |

The art went through a second repaint, after the board was compared against a
printed Ludo sheet: the walnut-and-marble version was a *table*, and a printed
board has no highlights in it. It is now flat print — cream stock, one ink
(`#2e2a22`), four seat colours — with a creature printed in each yard, ivory
squares in an ink lattice, a pinwheel rosette where the four lanes arrive, and
flame/leaf/wave/bolt motifs in the margin. The four creatures are the real cast —
Charmander, Bulbasaur, Squirtle and Pikachu, one per colour, matching the
reference sheet — taken from the official artwork set (the `PokeAPI/sprites`
repo's `other/official-artwork` directory), trimmed to their outlines, squared and
written to `public/art/ludo/yard-*.webp` at 512 px, ~35–41 KB each. They are the
only images the board needs; everything else is drawn. The board is
painted **once** into an offscreen canvas and blitted each frame; only the pieces
move, so the detail costs nothing per frame. If a creature never arrives the
painter prints that seat's emblem in the same place instead, so nothing pops.

Two geometry faults were found while repainting and fixed: piece positions are
square *centres* (`index + 0.5`) while squares are drawn from their index, so a
piece was landing half a square up and left of the square the referee said it was
on; and the yard sockets now sit in the four corners of each yard (`0.75 … 4.25`)
instead of under the creature, which is how a printed board lays them out.

The board is a canvas and therefore a picture to a keyboard and a screen reader,
so every move also exists as a real button ("Token 2 — 14 to home"), on both the
solo screen and in a room. The canvas publishes the geometry it actually drew
(`data-ludo-pad`, `data-ludo-cell`) so tests aim at pixels that exist instead of
re-deriving them.

**Repaint verified** in a real Chromium: the board was captured straight out of
the dev-server module graph at 840 px and 360 px, and inside the app at 428 px
(desktop) and 362 px (phone), with pieces in the yards, on the ring, in a home
lane, at home, stacked two deep and mid-hop; every piece sat in the centre of the
square the referee had it on. A solo game was then played for real — 18 rolls, 14
moves, a token out of the yard — with no console errors, and the room pass ran
17/17 through the relay. The capture animation is still the one thing not caught
on camera.

**Gameplay-tested** (a real Chromium, real clicks): a full two-player game to a
win — 164 rolls, 121 moves, 43 passes, **0 dead ends**, "Rose wins", no console
errors; the same driver in the room, through the relay, 15/15; and 24 whole games
replayed in the unit suite, asserting on every move that the turn only stays put
for a six or a capture, that home count never falls, that captures happen, and
that every game ends. **Smoke-tested only:** the visible capture animation (rules
and relay are covered, but the flight home was not caught on camera), and the
stacked-token badge.

## Addendum: the carrom rail, and the ludo cast

Two notes from a pass over the look of both boards:

**The carrom rail was eating the board.** It had been set to 16.7% of the board
per side to stop the board looking like a diagram, which over-corrected: a third
of the picture was wood and the playing surface — the part with the game in it —
looked pinched. 12.5% was still too much, so it was measured instead of guessed:
a horizontal scan through the reference sheet shows the walnut at 5.6% of the
picture each side with the bed at 76% of it, so the rail is a sixteenth of the
board (6.5%) and the cream margin came down from 4% to 1.2% at the same time —
the board had been floating in its own tablecloth. `layout()` now has a test
(`src/games/carrom/__tests__/layout.test.ts`) pinning all of that: the bed is
84%+ of the picture, the rail stays between 5 and 7.5% of the board, the margin
stays under 2%, and the bed still maps onto the referee's 100 units. Two
related faults came out with it: four "rail shadow" bands were being filled
across the rail's full width and height instead of onto the bed, so the north
rail's shadow painted a dark cross through the whole frame (the bed paints its
own edge shadow inside its own clip, so they were also doubling up); and the
double rule and the corner joint discs were drawn at half the weight and half the
size the reference has them. Nothing about the physics moved: the bed is still
100 units, the pockets still kill at `POCKET_R`, and `layout()` is the single
place the bed is mapped to pixels, so aiming and the referee's geometry agree.

**Ludo's yards now hold the actual Pokémon.** The first repaint drew four
creatures generated for the job; they read as the right animals but they were not
the cast. They are the official artwork now, keyed on their transparent
backgrounds and sized to the same optical weight, so the blue yard is Squirtle,
green is Bulbasaur, red is Charmander and gold is Pikachu — the colour-to-creature
mapping the reference sheet uses. The shelf cover was regenerated to show the same
four, so the card and the board agree.

Verified in a real Chromium after both changes: the boards at 840 px and at 362 px
(phone) and 470 px (desktop carrom) with no console errors; carrom's room pass
20/20 through the relay (a shot played, both boards agreeing) and ludo's 17/17;
unit suite 1089/1089; lint, build and seo clean.

**The shelf cards were from another art direction.** Every other card in the
library is soft watercolour — pastel rose, butter, sage and powder blue, a chai
cup and a knitted blanket in the corner, sparkles near the pieces. The carrom
card was a hard photographic render of a gold-edged board and the ludo card was a
flat print mock-up, so those two read as imports from a different game. Both were
regenerated in the shelf's own world, with the real subject in the frame: carrom
with its pastel coin ring and red queen, ludo with the four creatures and its
pinwheel rosette. They now sit next to Checkers, Mancala and Gomoku without
standing out.
