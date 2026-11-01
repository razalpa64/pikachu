/**
 * VANTA's own palette, in one place.
 *
 * The rest of the app is warm cream and pastel; VANTA is the one table in the
 * house with the lights down. Six colours, no gradients on the pieces, no glow —
 * the brief was explicit that this must not look like a neon "AI game".
 */
export const INK = '#15191F';
export const SLATE = '#20242C';
export const IVORY = '#E9E6DF';
export const PAPER = '#F4F0E8';
export const CORAL = '#F16B61';
export const ASH = '#A8ADB5';

/** The two seats: ivory sits at the bottom, coral at the top. */
export const seatColor = (slot: 0 | 1) => (slot === 0 ? IVORY : CORAL);
/** The colour that reads on top of a seat colour. */
export const onSeat = (slot: 0 | 1) => (slot === 0 ? SLATE : '#2a1412');
