# Pikachu Arcade — art direction bible

One page of rules for every painting, sprite, cover, piece of motion and sound in
the arcade. It exists so the 30th game looks like it belongs to the same hand as
the 1st, and so "make it prettier" has an answer that is not an opinion.

Everything here is measured against what is actually in the repository
(`src/styles.css`, `src/components/artManifest.ts`, `public/art/…`), not against a
mood board. If a rule here and a token in `styles.css` ever disagree, the token
wins and this document is out of date — fix the document.

---

## 1. The idea in one sentence

A **soft arcade**: cream paper, butter-yellow light, cocoa ink, one restrained
blush-red for trouble, painted like a children's picture book that an adult would
happily hang on a wall. It is a game table on a veranda in the late afternoon,
not a slot machine.

Three consequences that settle most arguments:

1. **Paper, not glass.** Surfaces are matte and slightly warm. No glossy
   gradients, no neon rim-light, no blurry "AI glow" behind anything.
2. **Drawn, not rendered.** Visible brush edge, paper grain, chalky shadow.
   Illustration carries the identity; the UI stays quiet around it.
3. **Two hands on one table.** Every screen has to read as something two people
   share — no dark-mode esports framing, no leaderboard aggression.

---

## 2. Colour

The palette is fixed. A game does **not** get its own palette; it gets **one
accent** taken from this list, plus its painting.

| Token | Hex | Role |
| --- | --- | --- |
| `ink-900` | `#fff8ec` | page paper |
| `ink-800` | `#fffdf7` | card face — the reference surface for all contrast |
| `ink-600` / `ink-500` / `ink-400` | `#f0dcc2` / `#e2c6a6` / `#c9a888` | hairline, border, strong border |
| `cream-100` | `#5c4035` | primary ink (11.8:1 on paper) |
| `cream-300` / `cream-400` / `cream-500` | `#74564a` / `#83655a` / `#8a6b5d` | secondary, medium, muted — the last is the AA floor for 11 px |
| `volt-400` / `volt-500` / `volt-600` | `#ffd24d` / `#fbc02d` / `#e8a21c` | butter-yellow light: fills, focus, the "your turn" tint |
| `volt-700` | `#8d5a05` | yellow used **as text** (5.5:1) |
| `blush-600` | `#bd2756` | the site's one alarm red — loses, errors, danger only |
| `leaf-700` | `#17795a` | success / score-positive text |
| `sky-400`, `mint-400`, `ember-600` | `#8ec8f6`, `#8fdcbb`, `#c73f5c` | supporting tints, never text on paper |

Rules:

* **Accents are text-safe or they are not accents.** A per-game accent must clear
  **5:1** on `#fffdf7`; `contrast.test.ts` holds the line. Today's accents:
  chess `#8d5a05`, WYR `#8f4a2b`, Word Bomb `#28759c`, and so on.
* **Red means "you lost or you are about to".** It is never decoration, never a
  category colour, never used for a *good* outcome.
* **Colour is never the only signal.** Every state that uses colour also carries a
  word, a shape or an icon — a colour-blind player must be able to read the board
  (WCAG 1.4.1).
* **Nothing glows.** If a shape needs to stand out it gets a heavier outline, a
  warmer fill or more space — not a shadow blur.

---

## 3. Type

Two faces, both self-hosted WOFF2 (`public/fonts/`), both rounded, neither
licensed per-page:

* **Baloo 2 — display.** Room titles, game names, scores, the big letter on the
  Word Bomb tile. Weights 600–800 only. Never used below 14 px, never used for
  paragraphs.
* **Quicksand — everything else.** Body copy, buttons, labels. 500 for labels,
  600–700 for buttons, 400 never below 12.5 px.

Numeric readouts (scores, clocks, move counts) get `.tabnum` so digits do not
jitter as they tick. Labels use `.eyebrow`: 10–11 px, 800 weight, uppercase,
tracking `0.14em`, `cream-400` or darker — below that they fail AA on paper.

---

## 4. Illustration

### What gets painted

One 1024 px master per **cover** (`art-src/game/<key>.png`), published as a
**640×640 WebP at quality 82–86, 8–400 KB** (`public/art/game/<key>.webp`).
Masters live outside `public/` so a deploy never ships working files.

Also painted, at their own sizes:

| Family | Where | Spec |
| --- | --- | --- |
| Piece sprites | `public/art/piece/*.webp` | 192 px, true alpha, knocked-out background with a soft 1 px edge so there is no white halo |
| Chess set | `public/art/chess/*` | 96 px per piece, same light direction as the board |
| Memory / Pika Pairs cards | `public/art/mem/*.webp` | 18 painted faces, ~17 KB each, all from the same sheet of paper |
| Pikachu clips | `public/art/pika/*` | 12 poses, same proportion sheet (see §6) |
| Mascot family | `public/art/mascot/*` | hero, thinking, victory, defeated, waiting — one silhouette, five moods |
| Game sprites | `public/art/run/*`, `public/art/berry/*` | 128–220 px, true alpha, no drop shadow baked in (the engine draws it) |

### The painting brief (paste this into any generator, then fix by hand)

> Soft gouache / coloured-pencil storybook illustration on warm cream paper.
> Visible brush texture and paper grain. Muted premium palette: cream, butter
> yellow, dusty rose, brass gold, cocoa outlines, deep warm charcoal. Warm light
> from the upper right, soft long shadows, gentle vignette in the corners.
> Centred composition, generous breathing room, one clear subject. No text, no
> logos, no neon, no glow, no purple, no chrome, no lens flare, no gradient mesh.

### Hard rules

1. **No emoji as game art.** Ever. Not as a card face, not as a berry, not as a
   placeholder. Emoji render differently on every OS — it is the fastest way to
   lose the identity the whole bible is about.
2. **No CSS impressions of the paintings.** A "sun made of gradients" next to a
   painted cover reads as a broken image. Papers, cards and boards may be CSS
   (they are UI); characters, covers and game objects may not.
3. **No reuse of the hero as a game cover.** Each cover is painted for its game.
4. **Transparent means transparent.** Check the alpha channel — a white box
   behind a berry is a bug, and a baked-in shadow double-shadows in dark boards.
5. **No placeholders in production.** If art is not ready, the manifest falls back
   to a real painted alternative, and `catalog.test.ts` fails on a missing file.
6. **One subject, one idea.** A cover should be recognisable at 96 px in a rail.

---

## 5. Composition — how a screen is built

The order of reading on every game screen, and it does not change per game:

1. **Who/what/where** — the game's painting or board.
2. **State** — whose turn, what is happening, the clock.
3. **Action** — the thing I am meant to press, biggest and nearest my thumb.
4. **Consequence** — score, chain, log, strikes.

A game may restyle 1 and 4; it may not reorder them, and it may never put a
decoration between 2 and 3. **Nothing decorative is allowed over the playing
surface**, which is why the Spark Reflex signal has its own cleared field rather
than a glowing orb floating above a scene.

Per-game identity means all of the following differ, and none of them are optional:

| Element | What "different" means |
| --- | --- |
| Cover | own painting, own accent, own composition |
| Board surface | its own material (paper, cloth, wood, water, tile) |
| Score display | its own shape — not one shared HUD |
| Win state | its own words and its own painting |
| Loss state | its own words; never the same copy as another game |
| Mobile layout | reflow drawn for a thumb, not a squeezed desktop |

---

## 6. Character

Pikachu appears as an **illustrated mascot**, never as a 3D model, never as a
sticker rotated in CSS.

* Proportion sheet: head ≈ 1.35× body height, ear tips rounded, cheek circles at
  the horizontal centre-line of the face, tail bolt at a consistent angle.
* Palette per pose is identical: body `#ffd24d`, ear-tips `#5c4035`, cheeks
  `#ef6a7f`, eyes `#5c4035`. If a generated pose drifts, it is repainted, not
  colour-corrected with a filter.
* Five moods only — `hero`, `thinking`, `victory`, `defeated`, `waiting` — shared
  by the whole site. A game that needs a sixth explains why in its own file.
* **Motion is real motion.** A pose change is a swap of drawn frames (or a
  two-frame clip), not one PNG spinning or scaling.
* Reduced motion: every clip has a still. `prefers-reduced-motion` and the
  in-app `motion: off` both land on the still, and the *information* the motion
  carried (it is your turn, you won) survives as text and colour.

---

## 7. Motion

Four durations, inherited from `docs/motion.md`: 100–150 ms tick, 200–300 ms
move, 400–650 ms arrive, 900–1200 ms scene. One scene animation per screen — on a
game screen that is the board itself.

Game-specific requirements this bible adds:

* **The signal must never be obscured.** In Spark Reflex the cue appears in a
  cleared field with nothing overlapping it, at full contrast, and the reduced
  motion path is a hard colour+word change.
* **Falling things fall.** Four in a Row's disc travels down its column and lands
  with one soft impact; a win draws its line through the four discs.
* **Timers tick, they do not pulse.** A clock may change width or colour; it may
  not breathe.

---

## 8. Sound

* Optional, off until asked for, remembered in `localStorage`.
* **Autoplay-safe:** no audio context before a user gesture.
* **One voice at a time:** a sound that is still playing is ducked or stopped
  before the next starts. `sfx()` centralises this.
* Palette: short wooden clicks, soft marimba for success, a low felt thud for a
  loss, a rising two-note "Pika!" for a win. Nothing loops. Nothing plays over a
  countdown.
* Every sound has a muted equivalent: the visible feedback (flash, word, shape)
  always exists on its own.

---

## 9. GIFs

The supplied GIFs are *reactions*, so they are treated as such:

* Placed only at a result or a moment of consequence — never behind gameplay,
  never as a background, never looping under a board.
* Checked before use: size (each re-encoded to a short WebP/APNG loop under
  ~300 KB), frame count, and whether frame 1 is representative (many are mid-blink).
* A GIF is never the only signal; the same information exists as text.
* `prefers-reduced-motion` shows the first frame, not the loop.

---

## 10. Audio-visual inventory check (what QA actually runs)

* `catalog.test.ts` — every cover exists, is a WebP between 8 KB and 400 KB, and
  matches its manifest entry.
* `contrast.test.ts` — every accent clears 5:1 on `#fffdf7`; overlay ink pinned.
* Manual, per new game: 360 px wide, one-thumb reach, signal unobscured, result
  state readable with sound off and motion off, and no request 404 in the console.
* `npm run build` must stay green; a cover added without its manifest entry fails
  the build's tests, not the next visitor's first paint.

---

## 11. Honesty

Pokémon and Pikachu are Nintendo/Game Freak/The Pokémon Company properties. This
arcade is a fan project: it must not be sold, must not imply affiliation, and any
commercial use needs a licence first. Every claim on the site (player counts,
scores, "fastest") must be something the app can actually prove — where it
cannot, the copy says what is true instead.
