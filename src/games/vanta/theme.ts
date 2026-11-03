/**
 * VANTA's palette — borrowed, on purpose, from the house.
 *
 * The first build of this game gave it a palette of its own: near-black ink,
 * slate panels, ash grey, one coral accent. It looked sharp in isolation and
 * wrong in the app. Every other table in the arcade sits on warm cream paper
 * with honey outlines and two pastel seats, and a near-black board in the middle
 * of that shelf reads as a different product — or as a screenshot from somewhere
 * else pasted into the page.
 *
 * So the colours here are the site's own tokens, by value, and nothing else:
 * cream paper, cocoa ink, butter and blush for the two seats, mint for anything
 * the table does by itself (relays, seals, the bolt ring), leaf for a trap that
 * is yours. Import from this file rather than retyping a hex, so the board and
 * the solo screen can never drift apart again.
 */

/** page paper — the same wash the body sits on */
export const PAPER = '#fff8ec';
/** a raised card face, one step lighter than the page */
export const CARD = '#fffdf7';
/** the top of a card's gradient, used for anything with real height */
export const CARD_TOP = '#fffefb';
/** hairline between two soft surfaces */
export const CREAM = '#f0dcc2';
/** every border on the page, one value */
export const LINE = '#e0c3a2';
/** the strong border: outlines, the offset shadow under buttons, plinth edges */
export const LINE_STRONG = '#c89b78';

/** primary text — cocoa, the same ink as the rest of the site */
export const INK = '#5c4035';
/** secondary text, safe on cream */
export const INK_SOFT = '#74564a';
/** labels and captions; the AA floor for 11px text on cream */
export const INK_MUTED = '#8a6b5d';

/** seat 0 — butter yellow, the warm half of the arcade */
export const BUTTER = '#fbc02d';
export const BUTTER_LIGHT = '#ffe27a';
/** accent *text* on cream; 5.5:1, so labels can use it */
export const BUTTER_DEEP = '#8d5a05';

/** seat 1 — blush rose */
export const BLUSH = '#f2779a';
export const BLUSH_LIGHT = '#ffd6e2';
/** accent *text* on cream; 5.5:1 */
export const BLUSH_DEEP = '#bd2756';

/** the table's own colour: relays, seals, anything neutral and alive */
export const MINT = '#8fdcbb';
export const MINT_LIGHT = '#d6f3e7';
/** success text, and the colour of a snare you own */
export const LEAF = '#17795a';

/** the wood the board is printed on — same ramps as the chess and ludo plinths */
export const PLINTH = 'linear-gradient(170deg,#f6e0c0,#e8c9a0)';
export const CELL = '#fffaf1';

/** Seat → its colour, and the colour that reads on top of it. */
export const seatColor = (slot: 0 | 1) => (slot === 0 ? BUTTER : BLUSH);
export const seatLight = (slot: 0 | 1) => (slot === 0 ? BUTTER_LIGHT : BLUSH_LIGHT);
export const seatDeep = (slot: 0 | 1) => (slot === 0 ? BUTTER_DEEP : BLUSH_DEEP);
/** Text set on a solid seat colour: dark cocoa-brown on butter, deep maroon on rose. */
export const onSeat = (slot: 0 | 1) => (slot === 0 ? '#5a3a12' : '#5c1631');
/** A wash, for painting a square that a seat owns without hiding the cell. */
export const seatWash = (slot: 0 | 1, alpha = 0.26) =>
  slot === 0 ? `rgba(255,210,77,${alpha})` : `rgba(242,119,154,${alpha})`;
