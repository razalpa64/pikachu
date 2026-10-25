# Motion, sound and interaction rules

A short, enforceable description of how this arcade moves. It exists because
"consistent motion" is easy to claim and easy to lose: ten screens each inventing
their own duration is how a hand-built game stops feeling hand-built.

## The four durations

Every transition in the app sits on one of these, and nothing uses a fifth:

| Band | Value | Used for |
| --- | --- | --- |
| **tick** | 100–150 ms | press feedback, chip toggles, hover tints, key flashes |
| **move** | 200–300 ms | buttons, cards lifting, panels appearing, seat hand-overs |
| **arrive** | 400–650 ms | a cover zooming under the pointer, a result card landing |
| **scene** | 900–1200 ms | the one hero-level thing on a page — mascot entrance, showcase art |

Rules that keep those bands honest:

* **One scene animation per screen.** The front page has the hero mascot; the
  game screens have the board. Everything else is tick or move. Nothing is
  permanently animating in the background — no drifting particles over a board,
  no idle shimmer on a panel you are trying to read.
* **Motion explains, it does not decorate.** A piece moves along its path, a
  card flips over, a curtain slides across the hand. If an animation does not
  tell the player what just changed, it is not there.
* **Nothing bounces twice.** `pk-hop` and `pk-pop` are the only springy
  keyframes and they are reserved for the mascot and for a result appearing.

## Reduced motion

`prefers-reduced-motion: reduce` and the in-app `motion: off` setting both take
the same path (`html[data-motion="off"]`), collapsing every animation and
transition to 0.001 ms in `src/styles.css`. Anything that would have been
*communicated* by the animation must still work without it:

* the intro becomes a single one-second title card;
* the pass-and-play curtain still appears, it just does not slide;
* result overlays still appear, they just do not scale in.

Add new motion inside those two hooks, never with an inline `animationDuration`
that bypasses them.

## Sound

Sound is optional, off until the first interaction unlocks audio, remembered
across sessions, and every cue is a short file — no loops start on their own
except the jukebox on `/music`, which the visitor has to press play on. Overlap
is prevented in `src/lib/audio.ts`; a cue that is already playing is restarted,
never stacked.

## Quality tiers

`html[data-quality="performance"]` (chosen automatically on low-memory or
touch-only devices, and settable in Settings) removes the expensive decoration:
backdrop blur, film grain, scanlines, drifting hearts, and pinned background
gradients. Layout, colour and every interaction stay identical — the tier only
removes pixels that cost frames.

## Advertising

Never inside a match. The three slots that exist (`home-foot`, `library-foot`,
`feedback-foot`) are all below real content and render nothing until a publisher
id exists *and* the visitor has opted in — see `src/lib/ads.ts`.
