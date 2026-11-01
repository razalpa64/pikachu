# The wide layout

The phone layout is the reference: it is the one that was finished first, and
every note in this file is about the screens *above* `lg` (1024 px). Anything
below that breakpoint is untouched on purpose — the rules below are all written
as `lg:`/`xl:` variants or `@media (min-width: 1024px)` blocks, so a phone
renders byte-for-byte what it rendered before this pass.

## The header is 63 px, not 58

The site header is a 58 px row, plus a 3 px reading-progress strip, plus its own
2 px rule. Every sticky bar that parks under it used to be pinned to
`top-[58px]` — the number in the header's inner class — so a 5 px transparent
seam sat between the bar and the header, and the page scrolled through it.

`--topbar-h` in `styles.css` now carries the real number:

| viewport | value | why |
| --- | --- | --- |
| below `lg` | `58px` | the phone value, frozen |
| `lg` and up | `63px` | 58 + 3 + 2 |

Library's filter bar, Retro's filter bar, the solo title bar and the room bar all
read `top-[var(--topbar-h)]`. `src/components/__tests__/desktop-chrome.test.ts`
fails if anyone hard-codes 58 again.

**The frosted bars.** Both sticky surfaces are 92 % opaque *because* the blur
does the rest. The performance tier switches `backdrop-filter` off to keep
scrolling smooth, which turned those bars into windows over moving card art. On
the wide layout they now go fully opaque (`.sticky-chrome`) instead of glassy.
The rule is scoped to `min-width: 1024px` so the phone chrome is unchanged.

## One content width for the work pages

`1340px` is the shell's width — the header, Home, Library, Solo, Retro and Music
all use it. `Play together` was 1180, which put its left edge 46 px inside
every other page's and made the nav look misaligned when you changed screens. It
is 1340 now, with the game picker gaining the extra width as bigger covers.

`/retro/dos/:id` stays at 1180: it is not a page, it is a monitor sitting on a
desk, and the bezel is the layout.

## The front-page rails end on a whole card

Rail tiles were a fixed 196 px, so six fitted into 1272 px and the seventh was
cut in half at the right edge — which reads as a broken grid, not as "there is
more". The tiles now share the row exactly (five below `xl`, six from `xl` up),
so a resting rail ends on a whole cover and the chevrons still reach the rest.
The phone keeps its 176 px tile and its swipe.

## Solo screens: the board gets the height, the small print gets the column

A board is capped by the height it can afford, not by the column it is in
(`BoardStage`). The HUD, the rulebook and Pikachu's line all used to sit *above*
the board, spending ~200 px of that height on chrome: a 1440 × 900 window gave a
430 px board with 500 px of empty paper either side of it.

From `lg` up the content block is a two-column grid — 320 px of small print, then
the board, which starts at the very top and spans the full height. The stage
re-measures the extra room for itself, so every board grows without a new number
being introduced anywhere:

| screen | board before | board after |
| --- | --- | --- |
| Chess Arena | 432 px | 536 px |
| Carrom Table | 468 px | 570 px |
| Ludo Royale | 428 px | 528 px |

The last grid row is `1fr` on purpose. A spanning item's leftover height is
otherwise spread evenly over the rows it spans, which pushed the rulebook and the
commentary down the page in three loose bands; the empty `1fr` row absorbs that
slack instead.

## `/together`: the covers are the colour on that page

Twenty game covers at 50 % opacity under a full-height cream veil turned the
picker into faded paper. On the wide layout the art stays at full strength, the
veil covers only the title band, and the selected card is marked with a ring
instead of by being the least faded thing on screen. The phone keeps the veil:
there the cards are small enough that the title has to win.
