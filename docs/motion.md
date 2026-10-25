# Motion language

The arcade moves like a hand-made toy, not a dashboard. This is the short,
enforceable version of that sentence: which durations exist, what each one is
allowed to carry, and what has to happen when somebody asks for less motion.

## The four durations

Everything in the app uses one of these. If a transition needs a fifth, it is
usually two of these stacked, or it is decoration that should not be there.

| Token | Value | Allowed to carry |
| --- | --- | --- |
| `tick` | 100–150 ms | press feedback, colour changes, chip toggles, hover tints, a clock's width |
| `move` | 200–300 ms | a piece travelling one square, a card flipping, a panel appearing, a seat hand-over |
| `arrive` | 400–650 ms | a result card landing, a rail's covers settling after a route change |
| `scene` | 900–1200 ms | one thing per screen — the front-page hero, a win sequence — never two |

Easing: `cubic-bezier(.4,1.5,.5,1)` for anything that lands (it overshoots once
and settles), `ease-out` for anything that fades, `linear` only for a clock.

## Rules

1. **One scene animation per screen.** On a game screen it is the board. Nothing
   else is allowed to be permanently animating.
2. **Nothing decorative over a live signal.** The playing surface is cleared the
   moment it carries information — see `docs/art-direction.md` §5. A flash may
   sit on the *frame* of a button, never over the word you have to read.
3. **Fall, do not fade.** A disc falls into its slot and lands; it does not
   appear. A card turns; it does not dissolve.
4. **Clocks tick.** A timer may shrink, recolour or pulse exactly once when it
   passes a threshold. It never breathes continuously.
5. **Animation explains.** Every animation answers "what just changed?" If it
   cannot answer that in one sentence, it is decoration and it goes.
6. **Never block input.** Nothing animates over a control that is waiting to be
   pressed; the reaction pad in particular must be tappable on frame one.

## Reduced motion

`prefers-reduced-motion: reduce` and the in-app `motion: off` setting take the
same path — `html[data-motion="off"]` reduces every animation and transition to
0.001 ms in `src/styles.css`. Anything the motion was *communicating* must still
arrive another way:

* the intro becomes a single one-second title card;
* the pass-and-play curtain still appears, it simply does not slide;
* result overlays still appear, they do not scale in;
* the reaction signal changes colour and text with no flash;
* a falling disc is already in its slot on the next frame.

## Game-specific motion

| Game | The one thing that moves | Why |
| --- | --- | --- |
| Four in a Row | the disc falls and lands | the drop *is* the rule — it shows which column, and that gravity applied |
| Word Bomb | the fuse bar drains | the clock is the opponent; a shrinking bar reads faster than a number |
| Would You Rather | the two cards turn face-up at the reveal | it marks the moment secrecy ends |
| Spark Reflex | the pad's colour flips to butter-yellow | the signal must be readable in one frame, with no transition in the way |
| Pika Pairs | the card flips | showing which card you turned is the memory aid |
| Daily Puzzle | a square fills | no other motion at all; the grid is the whole game |

## Sound

Sound follows the same discipline as motion: short, one at a time, never over a
countdown, silent until the visitor asks for it. `sfx()` is the only entry point,
so "no overlap" is enforced in one place rather than remembered in thirty.
