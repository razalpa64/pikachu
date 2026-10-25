/**
 * Would You Rather — the dilemmas.
 *
 * Two options, no third door, nothing sensible in the middle. Written so that
 * almost everyone has an instant answer and a reason they want to defend, which
 * is the whole point of the game: the fun is in the gap between what your friend
 * *expects* you to pick and what you actually pick.
 *
 * Kept data-only and out of the rules module so the deck can grow without
 * touching the referee, and so the online game and the solo game read the same
 * list in the same order for a given seed.
 */
export interface Dilemma {
  id: number;
  a: string;
  b: string;
  /** optional second line under each option, for the ones that need a nudge */
  note?: string;
}

export const DILEMMAS: Dilemma[] = [
  { id: 1, a: 'A quiet night in', b: 'A loud night out' },
  { id: 2, a: 'Mountains', b: 'The sea' },
  { id: 3, a: 'Always ten minutes early', b: 'Always five minutes late' },
  { id: 4, a: 'A cat', b: 'A dog' },
  { id: 5, a: 'Only ever sweet food', b: 'Only ever savoury food' },
  { id: 6, a: 'Read the book first', b: 'Watch the film first' },
  { id: 7, a: 'Be able to fly', b: 'Be able to be invisible' },
  { id: 8, a: 'Window seat', b: 'Aisle seat' },
  { id: 9, a: 'Forever summer', b: 'Forever autumn' },
  { id: 10, a: 'Tea', b: 'Coffee' },
  { id: 11, a: 'A house full of plants', b: 'A house full of books' },
  { id: 12, a: 'Never use social media again', b: 'Never watch another film' },
  { id: 13, a: 'Know the ending', b: 'Be surprised' },
  { id: 14, a: 'Perfect memory', b: 'Perfect imagination' },
  { id: 15, a: 'Rain on the roof', b: 'Sun on the sheets' },
  { id: 16, a: 'Cook for someone', b: 'Be cooked for' },
  { id: 17, a: 'A long train ride', b: 'A short flight' },
  { id: 18, a: 'Speak every language', b: 'Play every instrument' },
  { id: 19, a: 'Always have exact change', b: 'Never have to queue' },
  { id: 20, a: 'One true friend', b: 'Twenty friendly strangers' },
  { id: 21, a: 'Live by the water', b: 'Live above the city' },
  { id: 22, a: 'An extra hour in the morning', b: 'An extra hour at night' },
  { id: 23, a: 'Plan the whole trip', b: 'Wander and see' },
  { id: 24, a: 'The first slice of cake', b: 'The last slice of cake' },
  { id: 25, a: 'A tiny cottage', b: 'A big loft' },
  { id: 26, a: 'Always be warm', b: 'Always be cool' },
  { id: 27, a: 'Tell the truth that hurts', b: 'Keep a kindness back' },
  { id: 28, a: 'Music while you work', b: 'Total silence' },
  { id: 29, a: 'A pet dragon', b: 'A pet dinosaur' },
  { id: 30, a: 'Never lose a game', b: 'Never lose a friend' },
  { id: 31, a: 'Fresh sheets', b: 'Fresh snow' },
  { id: 32, a: 'Spend a week alone', b: 'Spend a week never alone' },
  { id: 33, a: 'Room with a view', b: 'Room with a fireplace' },
  { id: 34, a: 'Sweet popcorn', b: 'Salted popcorn' },
  { id: 35, a: 'Text first', b: 'Call instead' },
  { id: 36, a: 'A gift you wanted', b: 'A gift you did not know you wanted' },
  { id: 37, a: 'Relive one perfect day', b: 'Visit one day of the future' },
  { id: 38, a: 'Long dinner', b: 'Long walk' },
  { id: 39, a: 'Own the playlist', b: 'Never pick the music' },
  { id: 40, a: 'Small wedding, big house', b: 'Big wedding, small house' },
  { id: 41, a: 'A window that always shows the sea', b: 'A door that opens anywhere' },
  { id: 42, a: 'Never be embarrassed again', b: 'Never be bored again' },
  { id: 43, a: 'A slow morning with the paper', b: 'A quick morning with a run' },
  { id: 44, a: 'Remember every birthday', b: 'Never remember your phone' },
  { id: 45, a: 'The last word', b: 'The last laugh' },
  { id: 46, a: 'Board game night', b: 'Film night' },
  { id: 47, a: 'Live somewhere it never rains', b: 'Live somewhere it always does' },
  { id: 48, a: 'Have the map', b: 'Have the compass' },
];

export const DILEMMA_BY_ID = new Map(DILEMMAS.map((d) => [d.id, d]));

/** Presentation for the two sides. Colour is never the only signal — each side
    also carries its own wordmark and letter, so the pair is legible in greyscale. */
export const SIDES = {
  a: { letter: 'A', label: 'This one', tint: '#fff0d6', border: '#c98a16', ink: '#6b4405' },
  b: { letter: 'B', label: 'That one', tint: '#ffe9f0', border: '#bd2756', ink: '#7a1c3a' },
} as const;
