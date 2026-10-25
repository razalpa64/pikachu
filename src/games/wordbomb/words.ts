/**
 * Words for the arcade's own use.
 *
 * Honest limitation, stated here and in the rules card: the referee checks the
 * *shape* of a word — letters only, long enough, starts with the lit letter, not
 * already played — because a verdict on whether "zephyr" is English cannot be
 * shipped in a client bundle, and a browser cannot ask a dictionary without
 * sending the word somewhere. So a human can always bluff a word past the bomb.
 *
 * This list exists for the other player: Pikachu needs real words to answer with,
 * and a word chain that dead-ends on the arcade's turn is not a game. It is
 * deliberately plain, common vocabulary — the AI should feel like a person who
 * has read a few books, not like a word list.
 */
export const WORDS: string[] = [
  'apple', 'apron', 'arrow', 'amber', 'angle', 'anchor', 'atlas', 'acorn', 'album', 'almond',
  'aria', 'attic', 'avenue', 'awake',
  'banana', 'badge', 'baker', 'bamboo', 'basket', 'beacon', 'beetle', 'bishop', 'blanket', 'bloom',
  'border', 'bottle', 'bramble', 'breeze', 'bridge', 'bronze', 'bubble', 'bucket', 'butter', 'button',
  'cabin', 'cactus', 'candle', 'cannon', 'canvas', 'carpet', 'castle', 'cedar', 'cellar', 'chalk',
  'cherry', 'circle', 'clover', 'cobalt', 'coffee', 'comet', 'copper', 'coral', 'cotton', 'cradle',
  'crayon', 'cricket', 'crown', 'crystal',
  'daisy', 'dancer', 'dapple', 'dawn', 'decoy', 'denim', 'dinner', 'dolphin', 'donkey', 'dragon',
  'drawer', 'drizzle', 'drum', 'dune', 'dusty',
  'eagle', 'easel', 'echo', 'ember', 'embers', 'emerald', 'engine', 'envelope', 'escapade',
  'fable', 'falcon', 'feather', 'fennel', 'ferry', 'fiddle', 'figure', 'flannel', 'flint', 'florist',
  'flower', 'flute', 'forest', 'fossil', 'fountain', 'freckle', 'frost', 'fudge',
  'gadget', 'galaxy', 'garden', 'garland', 'gather', 'gecko', 'ginger', 'glacier', 'glider', 'glossy',
  'goblet', 'golden', 'granite', 'grape', 'grassy', 'guitar', 'gully',
  'hammock', 'hamster', 'harbor', 'hazel', 'header', 'hearth', 'hedge', 'helmet', 'hermit', 'hickory',
  'hollow', 'honey', 'horizon', 'humble', 'hummingbird',
  'iceberg', 'igloo', 'indigo', 'inkwell', 'island', 'ivory',
  'jacket', 'jaguar', 'jasmine', 'jelly', 'jigsaw', 'jolly', 'journal', 'jungle', 'juniper',
  'kayak', 'kettle', 'kitten', 'knapsack', 'knight', 'koala',
  'ladder', 'lagoon', 'lantern', 'lattice', 'lava', 'lemon', 'lentil', 'lettuce', 'library', 'lilac',
  'linen', 'lizard', 'lobby', 'locket', 'lotus', 'lumber', 'lunar', 'lychee',
  'magnet', 'mahogany', 'mango', 'maple', 'marble', 'marigold', 'meadow', 'melon', 'mercury', 'meteor',
  'midnight', 'mimic', 'mint', 'mirror', 'mitten', 'monsoon', 'mosaic', 'mossy', 'mountain', 'muffin',
  'mustard', 'mystery',
  'napkin', 'nectar', 'needle', 'nestle', 'nickel', 'nimble', 'noodle', 'notebook', 'nugget', 'nutmeg',
  'oasis', 'oatmeal', 'ocean', 'octopus', 'olive', 'onion', 'opal', 'orange', 'orbit', 'orchard',
  'orchid', 'otter', 'outpost', 'oven', 'owl',
  'paddle', 'palace', 'pancake', 'panda', 'paper', 'parrot', 'pastel', 'pebble', 'penguin', 'pepper',
  'petal', 'piano', 'picnic', 'pillow', 'pineapple', 'pixel', 'planet', 'plum', 'pocket', 'poem',
  'polar', 'poplar', 'poppy', 'postcard', 'prairie', 'pretzel', 'prism', 'puddle', 'pumpkin', 'puzzle',
  'quaint', 'quarry', 'quartz', 'quilt', 'quiver', 'quokka',
  'rabbit', 'radish', 'raffle', 'rainbow', 'rapid', 'raven', 'reeds', 'ribbon', 'river', 'robin',
  'rocket', 'rosemary', 'rubber', 'ruby', 'rustic',
  'saddle', 'saffron', 'sailor', 'salmon', 'satchel', 'scarlet', 'scissors', 'seashell', 'sequin',
  'shadow', 'shallot', 'shelter', 'sherbet', 'shimmer', 'shore', 'silver', 'slipper', 'smitten',
  'snuggle', 'socket', 'sorbet', 'sparkle', 'spindle', 'spring', 'spruce', 'squirrel', 'starfish',
  'statue', 'stitch', 'strawberry', 'summit', 'sunset', 'surprise', 'swallow', 'sweater', 'swing',
  'tablet', 'tangerine', 'tapestry', 'teacup', 'teapot', 'thimble', 'thistle', 'thunder', 'tickle',
  'timber', 'toaster', 'tomato', 'tornado', 'tortoise', 'tower', 'treasure', 'tremble', 'tricycle',
  'trinket', 'trousers', 'trumpet', 'tulip', 'tundra', 'turquoise', 'turtle', 'twilight',
  'umbrella', 'unicorn', 'universe', 'upside', 'urban',
  'valley', 'velvet', 'vesper', 'village', 'violet', 'violin', 'vivid', 'voyage',
  'waffle', 'wagon', 'walnut', 'walrus', 'wander', 'warmth', 'wasabi', 'waterfall', 'weasel',
  'whisker', 'whistle', 'wicker', 'wildflower', 'willow', 'window', 'winter', 'wizard', 'wonder',
  'xylophone',
  'yarrow', 'yonder', 'yogurt', 'yoyo',
  'zebra', 'zephyr', 'zigzag', 'zinnia', 'zodiac',
];

/** Every letter the bomb lights up. Keeping the awkward ones out of the opening
    letter is a kindness, not a rule — they can still arrive by word ending. */
const OPENING = 'abcdefghijklmnoprstw';

export const wordsStartingWith = (letter: string): string[] =>
  WORDS.filter((w) => w.startsWith(letter.toLowerCase()));

/** Deterministic opening letter, so the same seed is the same game. */
export function openingLetter(seed: number): string {
  const i = Math.abs(seed) % OPENING.length;
  return OPENING[i];
}

/** Rotate to a fresh letter when a turn is burnt: deterministic, never the same
    as the one just failed, and always answerable from the list above. */
export function nextLetter(seed: number, step: number, avoid: string): string {
  const pool = OPENING.split('').filter((c) => c !== avoid && wordsStartingWith(c).length >= 3);
  return pool[(Math.abs(seed) + step * 7) % pool.length];
}
