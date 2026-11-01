# VANTA's art direction, and why it changed

VANTA is the newest table in the arcade, and the only one built twice. The first
build was designed on its own terms; the second was designed as *part of this
shelf*. This file records what was wrong with the first one, because the mistake
was subtle and a future game could repeat it.

## The mistake

The first palette was `#15191F` ink, `#20242C` slate, `#E9E6DF` ivory,
`#F4F0E8` paper, `#F16B61` coral, `#A8ADB5` ash — a restrained, near-black
"quiet table in a dark room" look. Judged on its own, it was tasteful. Judged on
the shelf, it was wrong for three reasons:

1. **The site has one material language.** Cream paper, a honey-wood plinth,
   cocoa ink type, two pastel seats, a hard offset shadow instead of a soft glow.
   Every other board — chess, ludo, carrom, mancala — is *a physical object on
   paper*. A black slate board with a lamp on it is a different world.
2. **A shelf is scanned as a grid, not one card at a time.** A near-black
   thumbnail among thirty cream ones reads as a hole in the grid, which is why
   the first cover had to be replaced as well as the board.
3. **The dark theme fought the app's own chrome.** The room, the HUD, the result
   overlay and the coach bubble are all cream surfaces. A dark board inside them
   looked pasted in — because it was.

## The rule that came out of it

A game may have its **own metaphor**; it may not have its **own palette**.

VANTA kept its metaphor — two seats writing plans in secret, a table that
resolves both at once — and gave up every colour it had invented:

| role | token | value |
| --- | --- | --- |
| page / card | paper, card | `#fff8ec`, `#fffdf7` |
| border | line, line-strong | `#e0c3a2`, `#c89b78` |
| type | ink, ink-soft, ink-muted | `#5c4035`, `#74564a`, `#8a6b5d` |
| seat 0 | butter | `#fbc02d` (text `#8d5a05`) |
| seat 1 | blush | `#f2779a` (text `#bd2756`) |
| the table itself | mint | `#8fdcbb` (text `#17795a`) |
| your own snare | leaf | `#17795a` |

All of it lives in `src/games/vanta/theme.ts` and nowhere else. Board and solo
screen import from that one file, so they cannot drift apart.

## How the metaphor survives the palette

- **The plinth.** The board is a honey-wood slab with a 3 px strong-line edge and
  the same double shadow as the chess plinth — the same object, a different
  inlay.
- **Relays are inlaid diamonds**, mint while unclaimed, the owner's colour once
  held. **Cores are printed seals** with an inner diamond, so they speak the same
  language as the relays.
- **Agents are the shelf's lacquered coins** (`/art/piece/checker-gold.webp`,
  `checker-blush.webp`) — the exact tokens ludo, reversi and checkers use — each
  stamped A/B/C on a **cream chip**, because a letter set straight onto the dark
  rose coin measured about 2:1 contrast.
- **A held square is a wash**, not a fill: the cream paper still shows through,
  so ownership reads as ink on paper rather than as a second checkerboard you
  have to decode.
- **A bolt is an inset ring.** Only bolted relays count toward the sweep, so the
  ring is a primary mark, not decoration, and the legend says `ring = bolted`.

## The cover

Generated to the same brief as the rest of the set: painted gouache texture on
cream paper, one object lit softly from the upper left, a sprig of eucalyptus, a
knitted mint cloth, a rose teacup — and the board itself in buckwheat honey with
cream squares, butter and blush lacquered markers, mint inlaid relays, one ringed
as bolted. Exported at 640 × 640 WebP (72 KB) into `public/art/game/vanta.webp`;
the source PNG stays in `art-src/`.

The registry accent (`#b07d18`) is a honey ochre sampled from that cover rather
than the old coral, so the tagline under the game's title is the same family as
its thumbnail.
